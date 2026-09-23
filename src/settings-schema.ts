/**
 * Host-side schema for the durable settings section; split from
 * `./settings.js` so the browser bundle never pulls schemastery in — only the
 * Host registers the schema, the browser receives the serialized envelope.
 *
 * @module dsh-llm-codebuddy/settings-schema
 */

import z from '@deepseek-ai/schemastery'
import {
  CUSTOM_LIMIT_FIELD,
  CUSTOM_LIMIT_MIN,
  DANGER_PCT_FIELD,
  DANGER_PCT_MAX,
  DANGER_PCT_MIN,
  DEFAULT_DANGER_PCT,
  DEFAULT_SHOW_USAGE,
  SHOW_USAGE_FIELD,
} from './settings.js'
import type { CodeBuddySettings } from './settings.js'

/**
 * Bounds live in the schema (not a `validate` hook) so configuration forms can
 * render them and bad values are refused at the write. `customLimit` carries
 * no default: an absent field resolves to `undefined`, keeping "follow the
 * meter's limit" expressible.
 */
export const CodeBuddySettingsSchema: z<CodeBuddySettings> = z.object({
  [SHOW_USAGE_FIELD]: z.boolean().default(DEFAULT_SHOW_USAGE),
  [CUSTOM_LIMIT_FIELD]: z.number().min(CUSTOM_LIMIT_MIN),
  [DANGER_PCT_FIELD]: z.number().step(1).min(DANGER_PCT_MIN).max(DANGER_PCT_MAX).default(DEFAULT_DANGER_PCT),
})
