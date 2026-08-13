export const labelScopes = ["annotation", "paper"] as const;
export type LabelScope = (typeof labelScopes)[number];

export const annotationTypes = ["highlight", "area"] as const;
export type AnnotationType = (typeof annotationTypes)[number];

export const DEFAULT_ANNOTATION_LABELS = [
  { name: "method", color: "#3b82f6" },
  { name: "result", color: "#22c55e" },
  { name: "question", color: "#f97316" },
  { name: "important", color: "#ef4444" },
  { name: "idea", color: "#a855f7" }
] as const;

export const DEFAULT_HIGHLIGHT_COLOR = "#fbbf24";

export const PAPER_LABEL_PALETTE = [
  "#3b82f6",
  "#22c55e",
  "#f97316",
  "#ef4444",
  "#a855f7",
  "#14b8a6",
  "#eab308",
  "#ec4899",
  "#64748b",
  "#8b5cf6"
] as const;

export function annotationColor(labels: ReadonlyArray<{ color: string }>): string {
  return labels[0]?.color ?? DEFAULT_HIGHLIGHT_COLOR;
}

/**
 * A stable palette colour for something that has none of its own — today, a
 * person's avatar, keyed on their email so one teammate keeps one colour across
 * the app and survives a rename.
 *
 * Case- and space-insensitive, so a seed cannot drift on capitalisation alone.
 */
export function paletteColorFor(seed: string): string {
  const normalized = seed.trim().toLowerCase().replace(/\s+/g, " ");
  // FNV-1a: short, stable across runtimes, and well spread for the short
  // strings topics are. A plain sum would map anagrams to the same color.
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return PAPER_LABEL_PALETTE[hash % PAPER_LABEL_PALETTE.length]!;
}

const INK: readonly [number, number, number] = [29, 39, 51]; // #1d2733

function parseHex(color: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) {
    return null;
  }
  let hex = match[1]!;
  if (hex.length === 3) {
    hex = hex.replace(/./g, (c) => c + c);
  }
  const n = parseInt(hex, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function toHex(rgb: readonly [number, number, number]): string {
  return `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The color as a translucent wash, for surfaces that should read as marker on
 * paper rather than as a filled block: the quoted text on an annotation card,
 * carrying the same hue the passage is highlighted with in the document.
 *
 * Text on top must be `ink` — the wash is a fraction of the hue over white, so
 * ink clears AA on any color, while the hue's own dark tone does not at low
 * alphas. Unparseable input washes toward ink, which is visible but neutral.
 */
export function tintColor(color: string, alpha: number): string {
  const rgb = parseHex(color) ?? INK;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

/**
 * Chip styling for a user-chosen label color: a light tint of the color as
 * background with a dark, same-hue text tone. Solid mid-tone chips can't reach
 * WCAG AA with either black or white text, so the tint scheme is used wherever
 * a label name is rendered; a solid dot next to the name keeps the raw hue
 * recognisable.
 *
 * `background` already includes `alpha`, ready for CSS; `alpha` is exposed so
 * tests (or canvas renderers) can composite it themselves.
 */
export function labelChipColors(color: string): {
  background: string;
  text: string;
  alpha: number;
} {
  const alpha = 0.15;
  const rgb = parseHex(color) ?? INK;
  // 35% of the label hue mixed toward ink: dark enough for AA on the tint,
  // tinted enough to still read as the label's color.
  const text = toHex(
    rgb.map((c, i) => Math.round(c * 0.35 + INK[i]! * 0.65)) as unknown as readonly [
      number,
      number,
      number
    ]
  );
  return {
    background: tintColor(color, alpha),
    text: parseHex(color) ? text : toHex(INK),
    alpha
  };
}
