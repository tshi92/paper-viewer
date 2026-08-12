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
    background: `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`,
    text: parseHex(color) ? text : toHex(INK),
    alpha
  };
}
