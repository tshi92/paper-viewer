import type { Prisma } from "@prisma/client";
import type { AnnotationView } from "@/lib/annotation-types";

export const annotationInclude = {
  author: { select: { id: true, email: true, name: true } },
  labels: { orderBy: { order: "asc" as const }, include: { label: true } },
  comments: {
    orderBy: { createdAt: "asc" as const },
    include: { author: { select: { id: true, email: true, name: true } } }
  }
};

export type AnnotationWithRelations = Prisma.AnnotationGetPayload<{ include: typeof annotationInclude }>;

export function toAnnotationView(annotation: AnnotationWithRelations): AnnotationView {
  return {
    id: annotation.id,
    type: annotation.type,
    pageNumber: annotation.pageNumber,
    position: annotation.position,
    quotedText: annotation.quotedText,
    areaImage: annotation.areaImage,
    createdAt: annotation.createdAt.toISOString(),
    author: annotation.author,
    labels: annotation.labels.map(({ label }) => ({
      id: label.id,
      name: label.name,
      color: label.color,
      scope: label.scope
    })),
    comments: annotation.comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      parentId: comment.parentId,
      createdAt: comment.createdAt.toISOString(),
      author: comment.author
    }))
  };
}
