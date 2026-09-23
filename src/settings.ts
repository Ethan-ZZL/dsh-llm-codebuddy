/**
 * Durable preference contract shared by both halves: the Host registers the
 * namespace schema, the browser binds the same namespace. The section is flat
 * because `set`/`unset` address top-level fields only.
 *
 * @module dsh-llm-codebuddy/settings
 */

/** Settings namespace this plugin owns in the user-settings document. */
export const CODEBUDDY_SETTINGS_NAMESPACE = 'llm-codebuddy'

/** Field: whether the sidebar foot renders the allowance indicator. */
export const SHOW_USAGE_FIELD = 'showUsage'

/** Field: optional custom quota cap, overriding the meter's reported limit. */
export const CUSTOM_LIMIT_FIELD = 'customLimit'

/** Field: used-percentage at which the indicator fill turns the danger color. */
export const DANGER_PCT_FIELD = 'dangerPct'

/** Default for {@link SHOW_USAGE_FIELD}: the indicator shows unless hidden. */
export const DEFAULT_SHOW_USAGE = true

/** Default for {@link DANGER_PCT_FIELD}. */
export const DEFAULT_DANGER_PCT = 90

/** Smallest accepted {@link CUSTOM_LIMIT_FIELD}. */
export const CUSTOM_LIMIT_MIN = 1

/** Smallest accepted {@link DANGER_PCT_FIELD}. */
export const DANGER_PCT_MIN = 1

/** Largest accepted {@link DANGER_PCT_FIELD}. */
export const DANGER_PCT_MAX = 100

/**
 * The durable CodeBuddy section. `customLimit` stays optional on purpose: an
 * absent field means "follow the meter's limit", not a zero budget.
 */
export interface CodeBuddySettings {
  /** Whether the sidebar foot renders the allowance indicator. */
  showUsage: boolean
  /** Custom quota cap, when the user set one. */
  customLimit?: number
  /** Used-percentage at which the indicator fill turns the danger color. */
  dangerPct: number
}

/** One top-level field of the durable section; the unit of a scope write. */
export type CodeBuddySettingsField = keyof CodeBuddySettings
