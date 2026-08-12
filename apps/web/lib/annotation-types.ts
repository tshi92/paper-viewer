export type LabelView = {
  id: string;
  name: string;
  color: string;
  scope: "annotation" | "paper";
};

/** A label plus how many annotations and papers currently carry it. */
export type LabelListItem = LabelView & {
  usageCount: number;
};

export type AnnotationCommentView = {
  id: string;
  body: string;
  parentId: string | null;
  createdAt: string;
  author: { id: string; email: string; name: string | null };
};

export type AnnotationView = {
  id: string;
  type: "highlight" | "area";
  pageNumber: number;
  /** react-pdf-highlighter ScaledPosition, stored and returned as-is. */
  position: unknown;
  quotedText: string | null;
  /** PNG data URL screenshot of the region; only present on area annotations. */
  /**
   * URL of the area screenshot (own API route), or null for highlights. The
   * base64 payload itself never travels in list responses — at up to 500KB per
   * annotation it would ride along on every 30s poll.
   */
  areaImageUrl: string | null;
  createdAt: string;
  author: { id: string; email: string; name: string | null };
  labels: LabelView[];
  comments: AnnotationCommentView[];
};
