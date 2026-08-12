import { canManageWorkspaceSettings } from "@paper-viewer/core/permissions";
import { conferenceSourceUrl, parseGithubRepo, syncConferencesFromSource } from "@/lib/conference-sync";
import { requireCurrentUser } from "@/lib/auth";

// Importing a full multi-year catalog can exceed the default function limit.
export const maxDuration = 120;

/** Admin/owner action: pull the conference catalog from the configured repo. */
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

  // The default source is built in, so the only configuration failure left is
  // an override that is not a github.com repo URL.
  if (!parseGithubRepo(conferenceSourceUrl())) {
    return Response.json({ error: "source_not_configured" }, { status: 400 });
  }

  try {
    const result = await syncConferencesFromSource();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("[conference-sync] failed", error);
    // The route is admin-gated, so surfacing the concrete failure is safe and
    // beats a blind "try again" when e.g. an upstream host is unreachable.
    const detail = error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200);
    return Response.json({ error: "sync_failed", detail }, { status: 502 });
  }
}
