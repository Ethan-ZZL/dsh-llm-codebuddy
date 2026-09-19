/**
 * Serialize harness messages into a CodeBuddy (OpenAI-compatible) chat request.
 *
 * User text is joined, assistant text becomes `content`, tool calls become
 * `tool_calls`, and each tool result becomes its own `role: 'tool'` message —
 * the harness carries tool results inside user messages, which this wire route
 * does not accept. A user message carrying image blocks serializes into
 * OpenAI content parts with base64 data URLs, read through the durable
 * attachment service; text-only messages stay on the compact string form.
 *
 * @module dsh-llm-codebuddy/serialize
 */

import { contentHasImage, LlmError, offloadRequestImagesWithPolicy, offloadedImageText, requestImageHandleText } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import type {
  ImageAttachmentRef,
  ImageRequestPolicy,
  RequestImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import type { WireContentPart, WireMessage, WireRequest, WireTool } from './types.js'

/** The attachment-store face image serialization reads bytes through. */
export interface AttachmentReader {
  readImageRequest(
    ref: ImageAttachmentRef,
    policy: ImageRequestPolicy,
    signal?: AbortSignal,
  ): Promise<RequestImageAttachment>
}

/**
 * Image request policy for the CodeBuddy route. The catalog discloses no
 * per-model pixel or byte budget, so the harness defaults apply.
 */
const IMAGE_REQUEST_POLICY: ImageRequestPolicy = { maxPixels: 640_000, maxBytes: 1024 * 1024 }

/**
 * Per-request image limits for the CodeBuddy route. The service publishes no
 * budget, so these are conservative caps keeping one request from carrying an
 * unbounded image payload; `serializeRequest` offloads the oldest images to
 * text placeholders once either is exceeded.
 */
export interface ImageRequestLimits {
  /** Maximum number of images in one request. */
  maxImages: number
  /** Maximum total encoded image bytes (base64-expanded) in one request. */
  maxBytes: number
}

/** Default image limits: 20 inline images, 20 MiB of base64 payload. */
export const DEFAULT_IMAGE_REQUEST_LIMITS: ImageRequestLimits = { maxImages: 20, maxBytes: 20 * 1024 * 1024 }

/** Join the text blocks of one message. */
function flattenText(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/**
 * Refuse image content before any text flattening could silently drop it.
 * @param blocks - the message content.
 * @param supportsImages - whether the selected model declared image input.
 */
function assertSupportedContent(blocks: readonly ContentBlock[], supportsImages: boolean): void {
  if (!supportsImages && contentHasImage(blocks)) {
    throw new LlmError(
      'The selected CodeBuddy model does not accept image content.',
      'UNSUPPORTED_CONTENT',
    )
  }
}

/** Serialize one assistant turn: text, replayed reasoning, and tool calls. */
function serializeAssistant(message: Message): WireMessage {
  const text = flattenText(message.content)
  const reasoning = message.content
    .filter(block => block.type === 'reasoning')
    .map(block => block.text)
    .join('')
  const toolCalls = message.content
    .filter(block => block.type === 'tool-call')
    .map(block => ({
      id: block.id as unknown as string,
      type: 'function' as const,
      function: { name: block.name, arguments: block.arguments },
    }))
  return {
    role: 'assistant',
    // Always a string, never null: a reasoning-only or pure tool-call turn
    // sits durably in the session log, and gateways that reject null content
    // would break every later turn of that session rather than just this one.
    content: text,
    // Reasoning is replayed only on tool-call turns, where providers that
    // support thinking-mode passback require it; elsewhere it is ignored and
    // would only cost tokens.
    ...toolCalls.length > 0 && reasoning.length > 0 ? { reasoning_content: reasoning } : {},
    ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {},
  }
}

/** Collect image references from a block list, recursing into tool results. */
function collectImageRefs(blocks: readonly ContentBlock[], refs: Map<string, ImageAttachmentRef>): void {
  for (const block of blocks) {
    if (block.type === 'image') refs.set(block.attachment.attachmentId, block.attachment)
    else if (block.type === 'tool-result') collectImageRefs(block.content, refs)
  }
}

/**
 * Resolve every image reference in the conversation to its request version.
 * @param messages - the harness conversation.
 * @param attachments - the durable attachment store.
 * @param signal - optional cancellation for the reads.
 * @returns request versions keyed by attachment id; empty when no images.
 */
async function prepareRequestImages(
  messages: readonly Message[],
  attachments: AttachmentReader,
  signal?: AbortSignal,
): Promise<Map<string, RequestImageAttachment>> {
  const refs = new Map<string, ImageAttachmentRef>()
  for (const message of messages) collectImageRefs(message.content, refs)
  if (refs.size === 0) return new Map()
  const ordered = [...refs.values()]
  const projected = await Promise.all(ordered.map(ref => attachments.readImageRequest(ref, IMAGE_REQUEST_POLICY, signal)))
  const versions = new Map<string, RequestImageAttachment>()
  ordered.forEach((ref, index) => {
    const version = projected[index]
    if (version === undefined) {
      throw new LlmError(`CodeBuddy request image ${ref.attachmentId} could not be read.`, 'INVALID_REQUEST')
    }
    versions.set(ref.attachmentId, version)
  })
  return versions
}

/** One image as wire parts: a text handle describing it, then the data URL. */
function imageParts(
  attachmentId: string,
  images: ReadonlyMap<string, RequestImageAttachment>,
  precededByContent: boolean,
): WireContentPart[] {
  const version = images.get(attachmentId)
  if (version === undefined) {
    throw new LlmError(`CodeBuddy request image ${attachmentId} was not prepared.`, 'INVALID_REQUEST')
  }
  return [
    {
      type: 'text',
      text: `${precededByContent ? '\n' : ''}${requestImageHandleText(version.attachment, version)}`,
    },
    {
      type: 'image_url',
      image_url: {
        url: `data:${version.mediaType};base64,${Buffer.from(version.data).toString('base64')}`,
      },
    },
  ]
}

/** Ordered wire parts for one block list, resolving images through the map. */
function contentParts(
  blocks: readonly ContentBlock[],
  images: ReadonlyMap<string, RequestImageAttachment>,
): WireContentPart[] {
  const parts: WireContentPart[] = []
  for (const block of blocks) {
    if (block.type === 'text') {
      if (block.text.length > 0) parts.push({ type: 'text', text: block.text })
    } else if (block.type === 'image') {
      parts.push(...imageParts(block.attachment.attachmentId, images, parts.length > 0))
    } else if (block.type === 'tool-result') {
      parts.push(...contentParts(block.content, images))
    }
  }
  return parts
}

/** Compact string form when every part is text, otherwise the parts array. */
function userContent(parts: readonly WireContentPart[]): string | WireContentPart[] {
  const text: string[] = []
  for (const part of parts) {
    if (part.type !== 'text') return [...parts]
    text.push(part.text)
  }
  return text.join('')
}

/**
 * Serialize the conversation in order.
 *
 * Tool results expand into their own `role: 'tool'` entries, which accept only
 * string content — image blocks nested inside them move to a separate user
 * message emitted right after, the same relocation the official DeepSeek
 * adapter applies.
 *
 * The service honors image content only in the final user message: images in
 * earlier user messages are silently dropped once another user message
 * follows, so image parts are forwarded into the last user message, where
 * they ride alongside that message's own content.
 * @param messages - the harness conversation.
 * @param supportsImages - whether the selected model declared image input.
 * @param images - request versions for every image reference, keyed by id.
 * @returns the wire messages.
 */
export function serializeMessages(
  messages: readonly Message[],
  supportsImages: boolean,
  images: ReadonlyMap<string, RequestImageAttachment> = new Map(),
): WireMessage[] {
  // The service honors image content only in the final user message, so image
  // parts from earlier messages forward into the last user turn. The last
  // user message is found first so its own images stay in place.
  let lastUserIndex = -1
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    if (message === undefined) continue
    if (message.role !== 'user' && message.role !== 'assistant') continue
    if (message.role === 'user' && message.content.every(block => block.type !== 'tool-result')) lastUserIndex = i
  }
  const wire: WireMessage[] = []
  const forwarded: WireContentPart[] = []
  for (const [messageIndex, message] of messages.entries()) {
    assertSupportedContent(message.content, supportsImages)
    if (message.role === 'system') {
      wire.push({ role: 'system', content: flattenText(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      wire.push(serializeAssistant(message))
      continue
    }
    const toolResults = message.content.filter(block => block.type === 'tool-result')
    const userBlocks = message.content.filter(block => block.type !== 'tool-result')
    const userParts = contentParts(userBlocks, images)
    const userText = flattenText(userBlocks)
    const isLastUser = messageIndex === lastUserIndex
    if (userParts.length > 0) {
      // Image parts leave the message when it is not the final user turn;
      // they are appended to the final user message below.
      const keptParts = isLastUser ? userParts : userParts.filter(part => part.type !== 'image_url')
      forwarded.push(...(isLastUser ? [] : userParts.filter(part => part.type === 'image_url')))
      if (keptParts.length > 0) {
        wire.push({ role: 'user', content: userContent(keptParts) })
      } else if (toolResults.length > 0) {
        // The message carried only images; keep a placeholder user turn so
        // later tool results still follow one on the wire.
        wire.push({ role: 'user', content: userText })
      } else {
        wire.push({ role: 'user', content: userContent(userParts) })
      }
    } else if (userText.length > 0 || toolResults.length === 0) {
      // A text-only user message, or the message head before tool results.
      wire.push({ role: 'user', content: userText })
    }
    for (const result of toolResults) {
      const resultParts = contentParts(result.content, images)
      const imagePartsOfResult = resultParts.filter(part => part.type === 'image_url')
      wire.push({
        role: 'tool',
        tool_call_id: result.toolCallId as unknown as string,
        // Empty output still needs some content on the wire.
        content: flattenText(result.content) || '(no output)',
      })
      if (imagePartsOfResult.length > 0) {
        // Tool messages take string content only; the images are forwarded to
        // the final user message instead of a message of their own.
        forwarded.push(...imagePartsOfResult)
      }
    }
  }
  if (forwarded.length > 0) {
    const lastUser = [...wire].reverse().find(message => message.role === 'user')
    if (lastUser !== undefined) {
      const existing = lastUser.content
      lastUser.content = Array.isArray(existing)
        ? [...forwarded, ...existing]
        : [...forwarded, { type: 'text', text: existing }]
    } else {
      wire.push({ role: 'user', content: forwarded })
    }
  }
  return wire
}

/**
 * Build the chat-completions request body. Always streaming with usage
 * reporting; absent options are omitted rather than sent as null so the
 * provider's own defaults apply.
 *
 * When the request carries more images than {@link ImageRequestLimits} allows,
 * the oldest occurrences are replaced with text placeholders before
 * serialization, so an oversized request degrades instead of being rejected
 * outright.
 * @param options - the assembled harness request.
 * @param supportsImages - whether the selected model declared image input.
 * @param attachments - the durable attachment store, when images may occur.
 * @param reasoningSummary - the model's catalog thinking-summary level.
 * @param temperature - the model's catalog sampling temperature, used only
 *   when the caller expressed no preference.
 * @param limits - per-request image limits; defaults when omitted.
 * @returns the request body.
 */
export async function serializeRequest(
  options: GenerateOptions,
  supportsImages: boolean,
  attachments?: AttachmentReader,
  reasoningSummary?: string,
  temperature?: number,
  limits: ImageRequestLimits = DEFAULT_IMAGE_REQUEST_LIMITS,
): Promise<WireRequest> {
  const images = supportsImages && attachments !== undefined
    ? await prepareRequestImages(options.messages, attachments, options.signal)
    : new Map<string, RequestImageAttachment>()
  const requestMessages = images.size > 0
    ? offloadRequestImagesWithPolicy(options.messages, {
        // Base64 data URLs are what the wire carries, so the budget counts
        // the expanded length rather than the raw encoded bytes.
        representation: 'base64',
        byteLength: (ref) => {
          const version = images.get(ref.attachmentId)
          if (version === undefined) {
            throw new LlmError(`CodeBuddy request image ${ref.attachmentId} was not prepared.`, 'INVALID_REQUEST')
          }
          return version.bytes
        },
        maxBytes: limits.maxBytes,
        maxImages: limits.maxImages,
        placeholder: ref => offloadedImageText(ref),
      })
    : options.messages
  const messages: WireMessage[] = []
  if (options.system !== undefined) {
    messages.push({ role: 'system', content: options.system })
  }
  messages.push(...serializeMessages(requestMessages, supportsImages, images))

  const tools: WireTool[] | undefined = options.tools?.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))

  return {
    model: options.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...tools !== undefined && tools.length > 0 ? { tools } : {},
    // An explicit caller value wins; the catalog's own figure only fills the
    // gap, since it describes how the model is served rather than a request the
    // caller composed.
    ...options.temperature !== undefined
      ? { temperature: options.temperature }
      : temperature === undefined ? {} : { temperature },
    ...options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens },
    ...options.stop === undefined ? {} : { stop: options.stop },
    // The harness materializes a model's default effort into every request, so
    // this is normally set even when the caller chose nothing explicitly. The
    // id is CodeBuddy's own spelling, forwarded verbatim.
    ...options.reasoningEffort === undefined ? {} : { reasoning_effort: options.reasoningEffort },
    // A summary only qualifies the effort it accompanies, so it is never sent
    // on a request that carries no thinking level.
    ...options.reasoningEffort === undefined || reasoningSummary === undefined
      ? {}
      : { reasoning_summary: reasoningSummary },
  }
}
