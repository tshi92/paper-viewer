import { describe, expect, it } from "vitest";
import { ReadingState as PrismaReadingState, WorkspaceRole as PrismaWorkspaceRole } from "@prisma/client";
import { LabelScope as PrismaLabelScope, AnnotationType as PrismaAnnotationType } from "@prisma/client";
import { readingStates, type ReadingState as CoreReadingState } from "@paper-viewer/core/paper-status";
import { type WorkspaceRole as CoreWorkspaceRole } from "@paper-viewer/core/permissions";
import { labelScopes, annotationTypes } from "@paper-viewer/core/labels";

describe("enum parity", () => {
  it("core readingStates matches Prisma ReadingState", () => {
    const prismaValues = Object.values(PrismaReadingState).sort();
    const coreValues = [...readingStates].sort();
    expect(coreValues).toEqual(prismaValues);
  });

  it("core WorkspaceRole values match Prisma WorkspaceRole", () => {
    const prismaValues = Object.values(PrismaWorkspaceRole).sort();
    const expected = ["owner", "admin", "member"].sort();
    expect(expected).toEqual(prismaValues);
  });

  it("core labelScopes matches Prisma LabelScope", () => {
    expect([...labelScopes].sort()).toEqual(Object.values(PrismaLabelScope).sort());
  });

  it("core annotationTypes matches Prisma AnnotationType", () => {
    expect([...annotationTypes].sort()).toEqual(Object.values(PrismaAnnotationType).sort());
  });
});
