// Sign-In with Ethereum (EIP-4361): verifikasi pesan + signature, lalu buat sesi.
import { getAddress, verifyMessage } from "ethers";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, handler, ok } from "@/lib/api";
import { createSession } from "@/lib/session";
import { CHAIN_ID } from "@/lib/chain/config";

const Body = z.object({ message: z.string().max(2000), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) });

export const POST = handler(
  async (req) => {
    const { message, signature } = Body.parse(await req.json());
    const field = (name: string) => message.match(new RegExp(`^${name}: (.+)$`, "m"))?.[1]?.trim();
    const [firstLine, addressLine] = message.split("\n");
    const domain = firstLine.replace(" wants you to sign in with your Ethereum account:", "");
    const host = req.headers.get("host");
    if (!host || domain !== host) throw new ApiError(401, "SIWE_DOMAIN", "Domain pesan login tidak cocok.");
    if (Number(field("Chain ID")) !== CHAIN_ID) throw new ApiError(401, "SIWE_CHAIN", "Pindahkan wallet ke jaringan Sepolia.");

    const nonce = field("Nonce") ?? "";
    const row = await db.authNonce.findUnique({ where: { nonce } });
    if (!row || row.usedAt || row.expiresAt < new Date()) throw new ApiError(401, "SIWE_NONCE", "Pesan login kedaluwarsa. Coba lagi.");
    await db.authNonce.update({ where: { nonce }, data: { usedAt: new Date() } });

    let address: string;
    try {
      address = getAddress(addressLine.trim());
    } catch {
      throw new ApiError(401, "SIWE_ADDRESS", "Alamat wallet tidak valid.");
    }
    if (getAddress(verifyMessage(message, signature)) !== address) throw new ApiError(401, "SIWE_SIGNATURE", "Tanda tangan login tidak valid.");

    const user = await db.user.upsert({ where: { wallet: address }, update: {}, create: { wallet: address } });
    await createSession(user.id);
    return ok({ user: { id: user.id, wallet: user.wallet, name: user.name } });
  },
  { auth: false },
);
