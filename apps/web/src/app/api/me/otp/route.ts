// Verifikasi nomor HP. Provider SMS belum disambung: di development (atau production dengan OTP_DEMO=1 untuk
// demo hackathon) kode OTP dikembalikan di respons. Untuk rilis sungguhan kirim lewat provider SMS di sini.
import { randomInt } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, handler, ok } from "@/lib/api";

const Send = z.object({ action: z.literal("send"), phone: z.string().trim().regex(/^\+?\d[\d\s-]{8,16}$/, "Nomor HP tidak valid") });
const Verify = z.object({ action: z.literal("verify"), code: z.string().regex(/^\d{6}$/, "Kode OTP 6 digit") });

export const POST = handler(async (req, user) => {
  const body = await req.json();
  if (body.action === "send") {
    const { phone } = Send.parse(body);
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await db.user.update({
      where: { id: user.id },
      data: { phone: phone.replace(/[\s-]/g, ""), phoneVerifiedAt: null, otpCode: code, otpExpiresAt: new Date(Date.now() + 5 * 60_000) },
    });
    const demo = process.env.NODE_ENV !== "production" || process.env.OTP_DEMO === "1";
    return ok({ sent: true, devCode: demo ? code : undefined });
  }
  const { code } = Verify.parse(body);
  if (!user.otpCode || !user.otpExpiresAt || user.otpExpiresAt < new Date()) throw new ApiError(422, "OTP_EXPIRED", "Kode OTP kedaluwarsa. Kirim ulang.");
  if (user.otpCode !== code) throw new ApiError(422, "OTP_WRONG", "Kode OTP salah.");
  const updated = await db.user.update({ where: { id: user.id }, data: { phoneVerifiedAt: new Date(), otpCode: null, otpExpiresAt: null } });
  return ok({ user: updated });
});
