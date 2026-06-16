import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "./env";

const cookieName = "paper_viewer_session";

type SessionPayload = {
  userId: string;
};

function sign(value: string): string {
  return createHmac("sha256", getEnv().AUTH_SECRET).update(value).digest("base64url");
}

export function createSessionToken(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

export function readSessionToken(token: string | undefined): SessionPayload | null {
  if (!token) {
    return null;
  }

  const [body, signature] = token.split(".");
  if (!body || !signature) {
    return null;
  }

  const expected = sign(body);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    return null;
  }

  return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
}

export async function setSession(userId: string) {
  const cookieStore = await cookies();
  cookieStore.set(cookieName, createSessionToken({ userId }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.delete(cookieName);
}

export async function getSessionPayload(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  return readSessionToken(cookieStore.get(cookieName)?.value);
}
