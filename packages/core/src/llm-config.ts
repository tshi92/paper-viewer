/**
 * Language the model writes generated content in — paper intros and the daily
 * digest overview. It is a workspace setting rather than the reader's UI
 * locale: an intro is written once and stored, and the digest runs from cron
 * with no reader in sight, so there is no per-request locale to follow.
 *
 * Deliberately NOT covered by it: keyword tags (always English, so one
 * vocabulary stays searchable across a bilingual team) and AI chat, which
 * answers in whatever language the question was asked in.
 */
export const outputLanguages = ["zh", "en"] as const;
export type OutputLanguage = (typeof outputLanguages)[number];

export const DEFAULT_OUTPUT_LANGUAGE: OutputLanguage = "zh";

export function isOutputLanguage(value: unknown): value is OutputLanguage {
  return typeof value === "string" && (outputLanguages as readonly string[]).includes(value);
}

/** Falls back to the default for anything unrecognised, so a stale row can never break a run. */
export function toOutputLanguage(value: unknown): OutputLanguage {
  return isOutputLanguage(value) ? value : DEFAULT_OUTPUT_LANGUAGE;
}

export function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length < 12) return "***";
  const prefix = key.startsWith("sk-") ? "sk-" : key.slice(0, 3);
  return `${prefix}***${key.slice(-4)}`;
}
