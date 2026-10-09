import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";
import { db } from "./db";

const COOKIE = "pc_session";
const key = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET belum diisi (min. 32 karakter)");
  return new TextEncoder().encode(s);
};

export async function createSession(userId: string) {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(key());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export async function currentUser() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    if (!payload.sub) return null;
    return await db.user.findUnique({ where: { id: payload.sub } });
  } catch {
    return null;
  }
}

export type SessionUser = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
