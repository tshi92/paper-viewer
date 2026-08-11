export type LabelView = {
  id: string;
  name: string;
  color: string;
  scope: "annotation" | "paper";
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
  createdAt: string;
  author: { id: string; email: string; name: string | null };
  labels: LabelView[];
  comments: AnnotationCommentView[];
};
