// Konfirmasi / tolak pembayaran off-chain oleh kreditur.
import { getAddress, hexlify, randomBytes, verifyTypedData } from "ethers";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, handler, ok } from "@/lib/api";
import { audit, displayName, loadNote, roleOf, systemMessage } from "@/lib/notes";
import { PAYMENT_TYPES, managerDomain } from "@/lib/chain/eip712";
import { reader, relay } from "@/lib/chain/relayer";
import { fmtRp } from "@/lib/money";

type Ctx = { params: Promise<{ pid: string }> };

async function load(pid: string, user: Parameters<typeof loadNote>[1]) {
  const p = await db.payment.findUnique({ where: { id: pid } });
  if (!p) throw new ApiError(404, "NOT_FOUND", "Pembayaran tidak ditemukan.");
  const n = await loadNote(p.noteId, user);
  if (roleOf(n, user) !== "creditor") throw new ApiError(403, "FORBIDDEN", "Hanya kreditur yang mengonfirmasi pembayaran.");
  if (p.method !== "offchain" || p.status !== "PENDING") throw new ApiError(409, "INVALID_STATUS", "Pembayaran ini sudah diproses.");
  return { p, n };
}

/** Typed data PaymentConfirmation yang akan ditandatangani kreditur. */
export const GET = handler<Ctx>(async (_req, user, { params }) => {
  const { p, n } = await load((await params).pid, user);
  const remaining = await reader().manager.remaining(n.chainNoteId);
  return ok({
    domain: managerDomain,
    types: PAYMENT_TYPES,
    message: {
      noteId: n.chainNoteId,
      amount: p.amount,
      proofHash: p.proofHash,
      installmentIndex: p.installment,
      nonce: BigInt(hexlify(randomBytes(32))).toString(),
      deadline: Math.floor(Date.now() / 1000) + 3600,
      // Bukti menutup seluruh sisa: sisa denda kecil yang bertambah sampai tx masuk blok ikut dihapus kontrak.
      settleFull: BigInt(p.amount) >= remaining,
    },
    remaining: remaining.toString(),
  });
});

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("confirm"),
    signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
    message: z.object({
      noteId: z.string(), amount: z.string(), proofHash: z.string(), installmentIndex: z.number(), nonce: z.string(), deadline: z.number(), settleFull: z.boolean(),
    }),
  }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(5, "Tulis alasan penolakan").max(300) }),
]);

export const POST = handler<Ctx>(async (req, user, { params }) => {
  const { p, n } = await load((await params).pid, user);
  const body = Body.parse(await req.json());
  const name = displayName(user);

  if (body.action === "reject") {
    await db.payment.update({ where: { id: p.id }, data: { status: "REJECTED", rejectReason: body.reason } });
    await systemMessage(n.id, `${name} menolak bukti transfer ${fmtRp(p.amount)}: "${body.reason}"`);
    await audit(n.id, user.id, "REJECT_PAYMENT", body.reason);
    return ok();
  }

  if (!["ACTIVE", "OVERDUE"].includes(n.status)) throw new ApiError(409, "INVALID_STATUS", "Konfirmasi off-chain ditahan saat sengketa atau beku.");
  const m = body.message;
  if (m.noteId !== n.chainNoteId || m.amount !== p.amount || m.proofHash !== p.proofHash || m.installmentIndex !== p.installment)
    throw new ApiError(422, "CONFIRMATION_MISMATCH", "Data konfirmasi tidak cocok dengan bukti transfer.");
  if (getAddress(verifyTypedData(managerDomain, PAYMENT_TYPES, m, body.signature)) !== getAddress(user.wallet))
    throw new ApiError(422, "SIGNATURE_INVALID", "Tanda tangan tidak valid.");

  const rc = await relay("Konfirmasi pembayaran", (c) => c.manager.recordOffchainPayment.populateTransaction(m, body.signature));
  await db.payment.update({ where: { id: p.id }, data: { status: "CONFIRMED", txHash: rc.hash } });
  await systemMessage(n.id, `${name} mengonfirmasi transfer ${fmtRp(p.amount)}. Sisa utang diperbarui.`);
  await audit(n.id, user.id, "CONFIRM_PAYMENT", fmtRp(p.amount), rc.hash);
  return ok({ txHash: rc.hash });
});
