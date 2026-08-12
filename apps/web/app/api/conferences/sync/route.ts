import { canManageWorkspaceSettings } from "@paper-viewer/core/permissions";
import { conferenceSourceUrl, syncConferencesFromSource } from "@/lib/conference-sync";
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

  if (!conferenceSourceUrl()) {
    return Response.json({ error: "source_not_configured" }, { status: 400 });
  }

  try {
    const result = await syncConferencesFromSource();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("[conference-sync] failed", error);
    return Response.json({ error: "sync_failed" }, { status: 502 });
  }
}
