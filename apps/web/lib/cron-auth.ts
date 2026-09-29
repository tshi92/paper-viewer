import { timingSafeEqual } from "node:crypto";

/**
 * Bearer check shared by every /api/cron/* route. Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET` on its own; the comparison is
 * constant-time so the secret cannot be probed byte by byte.
 */
export function isCronAuthorized(request: Request, secret: string): boolean {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return false;
  }
  const token = Buffer.from(auth.slice(7));
  const expected = Buffer.from(secret);
  if (token.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(token, expected);
}
