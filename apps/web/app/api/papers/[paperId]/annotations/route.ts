import { prisma } from "@paper-viewer/db";
import { z } from "zod";
import { annotationTypes } from "@paper-viewer/core/labels";
import { requireCurrentUser, type CurrentUser } from "@/lib/auth";
import { annotationInclude, toAnnotationView } from "@/lib/annotation-view";

const scaledRect = z.object({
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
  width: z.number(),
  height: z.number(),
  pageNumber: z.number().int().positive().optional()
});

const createAnnotationSchema = z
  .object({
    type: z.enum(annotationTypes),
    pageNumber: z.number().int().positive(),
    position: z.object({
      boundingRect: scaledRect,
      // Area selections legitimately carry no rects — react-pdf-highlighter
      // builds them from `boundingRect` alone and emits `rects: []`. Text
      // highlights must still ship at least one rect (checked below).
      rects: z.array(scaledRect),
      pageNumber: z.number().int().positive(),
      usePdfCoordinates: z.boolean().optional()
    }),
    quotedText: z.string().max(4000).optional(),
    // Screenshot of the selected region, produced client-side by
    // react-pdf-highlighter. Only area selections have one.
    areaImage: z
      .string()
      .regex(/^data:image\/(png|jpeg);base64,/)
      .max(500_000)
      .optional(),
    labelIds: z.array(z.string()).max(10).default([]),
    firstComment: z.string().min(1).max(5000).optional()
  })
  .refine((input) => input.position.pageNumber === input.pageNumber, {
    message: "pageNumber mismatch",
    path: ["position", "pageNumber"]
  })
  .refine((input) => input.type !== "highlight" || input.position.rects.length > 0, {
    message: "highlight requires at least one rect",
    path: ["position", "rects"]
  })
  .refine((input) => input.type === "area" || input.areaImage === undefined, {
    message: "areaImage is only allowed on area annotations",
    path: ["areaImage"]
  });

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

  return Response.json({ annotations: annotations.map(toAnnotationView) });
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
      areaImage: input.areaImage ?? null,
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

  return Response.json({ annotation: toAnnotationView(annotation) }, { status: 201 });
}
