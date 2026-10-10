// Pembayaran off-chain: debitur upload bukti transfer → kreditur konfirmasi (signature) atau tolak (BR-18).
import { db } from "@/lib/db";
import { ApiError, handler, ok } from "@/lib/api";
import { audit, displayName, loadNote, roleOf, systemMessage } from "@/lib/notes";
import { readUploadFile } from "@/lib/upload";
import { fmtRp, rupiahToUnits } from "@/lib/money";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handler<Ctx>(async (req, user, { params }) => {
  const n = await loadNote((await params).id, user);
  if (roleOf(n, user) !== "debtor") throw new ApiError(403, "FORBIDDEN", "Hanya debitur yang mengirim bukti pembayaran.");
  if (!["ACTIVE", "OVERDUE"].includes(n.status))
    throw new ApiError(409, "INVALID_STATUS", "Bukti transfer hanya bisa dikirim saat piutang aktif (bukan saat sengketa/beku).");
  const form = await req.formData();
  const rupiah = String(form.get("amount") ?? "");
  if (!/^\d{1,13}$/.test(rupiah) || Number(rupiah) < 1) throw new ApiError(422, "INVALID_INPUT", "Nominal transfer tidak valid.");
  const installment = Number(form.get("installment") ?? 0) || 0;
  const f = await readUploadFile(form.get("proof") as File | null);
  const p = await db.payment.create({
    data: { noteId: n.id, method: "offchain", amount: rupiahToUnits(rupiah), installment, proofData: f.data, proofMime: f.mime, proofHash: f.hash, proofName: f.name },
  });
  await systemMessage(n.id, `${displayName(user)} mengirim bukti transfer ${fmtRp(p.amount)}. Menunggu konfirmasi kreditur.`, `/app/piutang/${n.id}#pembayaran`, user.id);
  await audit(n.id, user.id, "UPLOAD_PAYMENT_PROOF", fmtRp(p.amount));
  return ok({ id: p.id }, 201);
});
