import { canManageWorkspaceSettings } from "@paper-viewer/core/permissions";
import { requireCurrentUser } from "@/lib/auth";
import { runResearchers } from "@/lib/researcher-run";

// The daily cron's run and budget (lib/researcher-run.ts).
export const maxDuration = 300;

/**
 * Admin/owner action: the daily Researchers run on demand, for the caller's
 * workspace only. A failed step is recorded in the body rather than failing
 * the request, because the steps after it still ran; the button shows the
 * first one. The route is admin-gated, so returning the concrete messages is
 * safe.
 */
export async function POST() {
  let user;
  try {
    user = await requireCurrentUser();
  } catch {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  if (!canManageWorkspaceSettings(user.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  return Response.json({ ok: true, ...(await runResearchers([user.workspaceId])) });
}
