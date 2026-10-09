import { hexlify, randomBytes } from "ethers";
import { db } from "@/lib/db";
import { handler, ok } from "@/lib/api";

export const POST = handler(
  async () => {
    const nonce = hexlify(randomBytes(16)).slice(2);
    await db.authNonce.create({ data: { nonce, expiresAt: new Date(Date.now() + 5 * 60_000) } });
    return ok({ nonce });
  },
  { auth: false },
);
