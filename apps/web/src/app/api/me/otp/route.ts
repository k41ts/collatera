// Verifikasi nomor HP. Provider SMS belum disambung: di development (atau production dengan OTP_DEMO=1 untuk
// demo hackathon) kode OTP dikembalikan di respons. Untuk rilis sungguhan kirim lewat provider SMS di sini.
// Satu nomor hanya boleh terverifikasi di satu akun (dijaga juga oleh unique index parsial di DB).
import { randomInt } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, handler, ok } from "@/lib/api";
import { normalizePhone } from "@/lib/phone";

const Send = z.object({ action: z.literal("send"), phone: z.string().trim().max(32) });
const Verify = z.object({ action: z.literal("verify"), code: z.string().regex(/^\d{6}$/, "Kode OTP 6 digit") });

const PHONE_TAKEN = () => new ApiError(409, "PHONE_TAKEN", "Nomor HP ini sudah terverifikasi di akun lain.");

async function assertPhoneFree(phone: string, userId: string) {
  const other = await db.user.findFirst({ where: { phone, phoneVerifiedAt: { not: null }, NOT: { id: userId } }, select: { id: true } });
  if (other) throw PHONE_TAKEN();
}

export const POST = handler(async (req, user) => {
  const body = await req.json();
  if (body.action === "send") {
    const phone = normalizePhone(Send.parse(body).phone);
    if (!phone) throw new ApiError(422, "PHONE_INVALID", "Nomor HP tidak valid. Pakai nomor seluler Indonesia, misalnya 0812… atau +62812….");
    await assertPhoneFree(phone, user.id);
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await db.user.update({
      where: { id: user.id },
      data: { phone, phoneVerifiedAt: null, otpCode: code, otpExpiresAt: new Date(Date.now() + 5 * 60_000) },
    });
    const demo = process.env.NODE_ENV !== "production" || process.env.OTP_DEMO === "1";
    return ok({ sent: true, devCode: demo ? code : undefined });
  }
  const { code } = Verify.parse(body);
  if (!user.otpCode || !user.otpExpiresAt || user.otpExpiresAt < new Date()) throw new ApiError(422, "OTP_EXPIRED", "Kode OTP kedaluwarsa. Kirim ulang.");
  if (user.otpCode !== code) throw new ApiError(422, "OTP_WRONG", "Kode OTP salah.");
  if (user.phone) await assertPhoneFree(user.phone, user.id);
  try {
    const updated = await db.user.update({ where: { id: user.id }, data: { phoneVerifiedAt: new Date(), otpCode: null, otpExpiresAt: null } });
    return ok({ user: updated });
  } catch (e) {
    // dua akun memverifikasi nomor yang sama bersamaan: unique index menolak yang kedua
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw PHONE_TAKEN();
    throw e;
  }
});
