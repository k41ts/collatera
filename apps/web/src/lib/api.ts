import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { currentUser, type SessionUser } from "./session";
import { ChainError } from "./chain/relayer";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export const ok = (data: unknown = { ok: true }, status = 200) => NextResponse.json(data, { status });

/** Bungkus handler: sesi wajib, error → JSON { error: { code, message } }. */
export function handler<Ctx>(fn: (req: Request, user: SessionUser, ctx: Ctx) => Promise<Response>, opts: { auth?: boolean } = {}) {
  return async (req: Request, ctx: Ctx) => {
    try {
      const user = await currentUser();
      if (opts.auth !== false && !user) throw new ApiError(401, "UNAUTHORIZED", "Masuk dulu dengan wallet.");
      return await fn(req, user as SessionUser, ctx);
    } catch (e) {
      if (e instanceof ApiError) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
      if (e instanceof ZodError)
        return NextResponse.json({ error: { code: "INVALID_INPUT", message: e.issues.map((i) => i.message).join("; ") } }, { status: 422 });
      if (e instanceof ChainError) return NextResponse.json({ error: { code: "CHAIN_ERROR", message: e.message } }, { status: 502 });
      console.error(e);
      return NextResponse.json({ error: { code: "SERVER_ERROR", message: (e as Error).message } }, { status: 500 });
    }
  };
}
