import { prisma } from "@paper-viewer/db";
import type { WorkspaceRole } from "@paper-viewer/core/permissions";
import { getSessionPayload } from "./session";

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  workspaceId: string;
  role: WorkspaceRole;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const payload = await getSessionPayload();
  if (!payload) {
    return null;
  }

  const membership = await prisma.workspaceMembership.findFirst({
    where: { userId: payload.userId },
    include: { user: true }
  });

  if (!membership) {
    return null;
  }

  return {
    id: membership.user.id,
    email: membership.user.email,
    name: membership.user.name,
    workspaceId: membership.workspaceId,
    role: membership.role as WorkspaceRole
  };
}

export async function requireCurrentUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("Authentication required");
  }
  return user;
}
