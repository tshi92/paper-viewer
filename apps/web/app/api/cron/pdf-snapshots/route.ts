/**
 * Vercel Cron: daily at 20:00 UTC (vercel.json), which is 04:00 Beijing, clear
 * of the Today digest and Researchers runs. Deletes the PDF snapshots that only
 * cached a paper nobody saved (pruneSnapshots in lib/pdf-snapshot.ts), keeping
 * the Blob store inside the Hobby plan's 1 GB. Same auth and 404-without-secret
 * behaviour as /api/cron/daily-digest.
 */

import { isCronAuthorized } from "@/lib/cron-auth";
import { getEnv } from "@/lib/env";
import { pruneSnapshots } from "@/lib/pdf-snapshot";

export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = getEnv().CRON_SECRET;
  if (!secret) {
    return new Response("Not Found", { status: 404 });
  }
  if (!isCronAuthorized(request, secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pruned = await pruneSnapshots();
  return Response.json(pruned ? { ok: true, ...pruned } : { ok: true, skipped: "no Blob store" });
}
