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
