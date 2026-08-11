import { prisma } from "@paper-viewer/db";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { annotationTypes } from "@paper-viewer/core/labels";
import { requireCurrentUser, type CurrentUser } from "@/lib/auth";
import type { AnnotationView } from "@/lib/annotation-types";

const scaledRect = z.object({
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
  width: z.number(),
  height: z.number(),
  pageNumber: z.number().int().positive().optional()
});

const createAnnotationSchema = z.object({
  type: z.enum(annotationTypes),
  pageNumber: z.number().int().positive(),
  position: z.object({
    boundingRect: scaledRect,
    rects: z.array(scaledRect),
    pageNumber: z.number().int().positive(),
    usePdfCoordinates: z.boolean().optional()
  }),
  quotedText: z.string().max(4000).optional(),
  labelIds: z.array(z.string()).max(10).default([]),
  firstComment: z.string().min(1).max(5000).optional()
});

const annotationInclude = {
  author: { select: { id: true, email: true, name: true } },
  labels: { orderBy: { order: "asc" as const }, include: { label: true } },
  comments: {
    orderBy: { createdAt: "asc" as const },
    include: { author: { select: { id: true, email: true, name: true } } }
  }
};

type AnnotationWithRelations = Prisma.AnnotationGetPayload<{ include: typeof annotationInclude }>;

function toView(annotation: AnnotationWithRelations): AnnotationView {
  return {
    id: annotation.id,
    type: annotation.type,
    pageNumber: annotation.pageNumber,
    position: annotation.position,
    quotedText: annotation.quotedText,
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

async function resolveCurrentUser(): Promise<CurrentUser | null> {
  try {
    return await requireCurrentUser();
  } catch {
    return null;
  }
}

async function workspacePaperExists(workspaceId: string, paperId: string): Promise<boolean> {
  const workspacePaper = await prisma.workspacePaper.findUnique({
    where: { workspaceId_paperId: { workspaceId, paperId } }
  });
  return workspacePaper !== null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ paperId: string }> }) {
  const user = await resolveCurrentUser();
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const { paperId } = await params;
  if (!(await workspacePaperExists(user.workspaceId, paperId))) {
    return Response.json({ error: "Paper not found" }, { status: 404 });
  }

  const annotations = await prisma.annotation.findMany({
    where: { workspaceId: user.workspaceId, paperId },
    orderBy: [{ pageNumber: "asc" }, { createdAt: "asc" }],
    include: annotationInclude
  });

  return Response.json({ annotations: annotations.map(toView) });
}

export async function POST(request: Request, { params }: { params: Promise<{ paperId: string }> }) {
  const user = await resolveCurrentUser();
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const { paperId } = await params;
  if (!(await workspacePaperExists(user.workspaceId, paperId))) {
    return Response.json({ error: "Paper not found" }, { status: 404 });
  }

  const input = createAnnotationSchema.parse(await request.json());
  const labelIds = [...new Set(input.labelIds)];

  if (labelIds.length > 0) {
    const ownedLabelCount = await prisma.label.count({
      where: { id: { in: labelIds }, workspaceId: user.workspaceId, scope: "annotation" }
    });
    if (ownedLabelCount !== labelIds.length) {
      return Response.json({ error: "Invalid label" }, { status: 400 });
    }
  }

  const annotation = await prisma.annotation.create({
    data: {
      workspaceId: user.workspaceId,
      paperId,
      authorId: user.id,
      type: input.type,
      pageNumber: input.pageNumber,
      position: input.position,
      quotedText: input.quotedText ?? null,
      labels: {
        create: labelIds.map((labelId, index) => ({ labelId, order: index }))
      },
      ...(input.firstComment
        ? {
            comments: {
              create: {
                workspaceId: user.workspaceId,
                paperId,
                authorId: user.id,
                body: input.firstComment
              }
            }
          }
        : {})
    },
    include: annotationInclude
  });

  return Response.json({ annotation: toView(annotation) }, { status: 201 });
}
