/**
 * The language the Web client is displaying, as last reported by it.
 *
 * The client resolves its locale itself and that result exists only client-side,
 * so the host cannot derive it: the browser reports the tag over this plugin's
 * RPC channel and every host-side wording decision reads it back from here.
 *
 * @module dsh-llm-codebuddy/locale
 */

export class MessageLocale {
  private reported: string | undefined

  /** Record the resolved tag, or clear it when the client sent none. */
  report(tag: unknown): void {
    this.reported = typeof tag === 'string' && tag.length > 0 ? tag : undefined
  }

  /** The tag in effect, or undefined while the client has reported none. */
  tag(): string | undefined {
    return this.reported
  }
}

/**
 * Whether the Chinese wording should win. CodeBuddy discloses exactly two
 * wordings per field, so any `zh` tag prefers it — Simplified, Traditional, and
 * regional alike; every other tag, and an unreported one, reads English.
 *
 * Not {@link Intl.Locale}: the tag arrives from the network and `Intl.Locale`
 * throws on malformed input, which would drop the copy this reading selects.
 * @param language - the reported tag; `undefined` before the first report.
 */
export function prefersChinese(language: string | undefined): boolean {
  if (language === undefined) return false
  const tag = language.trim().toLowerCase()
  return tag === 'zh' || tag.startsWith('zh-')
}

/**
 * The `displayMsg` keys one tag may name, best first.
 *
 * Failure envelopes are the one place CodeBuddy discloses three wordings: a
 * language pack selects the Traditional Chinese one by region (`zh-TW`, `zh-HK`,
 * `zh-MO`), so those ids have to reach the `zh-hant` key.
 * @param language - the reported tag; `undefined` before the first report.
 */
export function wordingKeys(language: string | undefined): readonly string[] {
  const key = language?.trim().toLowerCase()
  if (key === undefined || key.length === 0) return []
  if (key === 'zh-tw' || key === 'zh-hk' || key === 'zh-mo') return [key, 'zh-hant']
  return [key]
}
