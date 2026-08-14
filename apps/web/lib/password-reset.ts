import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@paper-viewer/db";

/**
 * Password reset links: issuing them, and redeeming them exactly once.
 *
 * Only the hash of a token is stored, so a leaked database row cannot be
 * turned back into a working link — the same treatment invitations get. A link
 * is valid for an hour, is single-use, and issuing a new one invalidates any
 * outstanding link for that account, so a forwarded or shoulder-surfed older
 * email stops working the moment the real owner asks again.
 */
const TOKEN_TTL_MS = 60 * 60 * 1000;

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Issues a fresh link for a user, retiring any still outstanding. */
export async function createPasswordReset(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await prisma.$transaction([
    prisma.passwordReset.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() }
    }),
    prisma.passwordReset.create({
      data: {
        userId,
        tokenHash: hashResetToken(token),
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS)
      }
    })
  ]);
  return token;
}

/**
 * The user a link belongs to, or null when it is unknown, already used or
 * expired — the three cases the UI treats identically, since telling them
 * apart only helps someone probing tokens.
 */
export async function resolvePasswordReset(token: string): Promise<{ id: string; userId: string } | null> {
  if (!token) return null;
  const reset = await prisma.passwordReset.findUnique({
    where: { tokenHash: hashResetToken(token) },
    select: { id: true, userId: true, usedAt: true, expiresAt: true }
  });
  if (!reset || reset.usedAt || reset.expiresAt.getTime() < Date.now()) {
    return null;
  }
  return { id: reset.id, userId: reset.userId };
}

/**
 * Marks a link used, returning false when someone else redeemed it first.
 * The conditional update is what makes "single use" hold under a double
 * submit rather than only in the happy path.
 */
export async function consumePasswordReset(id: string): Promise<boolean> {
  const claimed = await prisma.passwordReset.updateMany({
    where: { id, usedAt: null },
    data: { usedAt: new Date() }
  });
  return claimed.count === 1;
}
