// Aksi alur draft: kirim untuk tanda tangan, batal, tolak, minta revisi (BR-05 s.d. BR-08).
import { TypedDataEncoder } from "ethers";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, handler, ok } from "@/lib/api";
import { audit, buildTerms, displayName, loadNote, requirePhone, roleOf, systemMessage } from "@/lib/notes";
import { NOTE_TYPES } from "@/lib/chain/eip712";
import { relay } from "@/lib/chain/relayer";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send") }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(5, "Tulis alasan minimal 5 huruf").max(500) }),
  z.object({ action: z.literal("revise"), reason: z.string().trim().min(5, "Tulis apa yang perlu diubah").max(500) }),
  z.object({ action: z.literal("closeExpiredDispute") }),
]);

export const POST = handler<Ctx>(async (req, user, { params }) => {
  const n = await loadNote((await params).id, user);
  const body = Body.parse(await req.json());
  const role = roleOf(n, user);
  const isCreator = n.creatorId === user.id;
  const name = displayName(user);

  if (body.action === "send") {
    requirePhone(user);
    if (!isCreator) throw new ApiError(403, "FORBIDDEN", "Hanya pembuat draft yang bisa mengirimnya.");
    if (n.status !== "DRAFT") throw new ApiError(409, "INVALID_STATUS", "Draft ini sudah dikirim.");
    if (!n.counterpartyWallet) throw new ApiError(422, "NO_COUNTERPARTY", "Isi alamat wallet pihak lawan dulu.");
    const creditorWallet = n.creatorRole === "creditor" ? user.wallet : n.counterpartyWallet;
    const debtorWallet = n.creatorRole === "debtor" ? user.wallet : n.counterpartyWallet;
    const { terms, schedule } = buildTerms(n, creditorWallet, debtorWallet);
    await db.note.update({
      where: { id: n.id },
      data: {
        status: "PENDING_SIGNATURE",
        termsJson: JSON.stringify(terms),
        scheduleJson: JSON.stringify(schedule),
        docHash: terms.docHash,
        noteHash: TypedDataEncoder.hashStruct("Note", NOTE_TYPES, terms),
        revisionNote: null,
      },
    });
    // Versi > 1 = hasil revisi: beri tahu pihak lawan bahwa permintaannya sudah dikerjakan.
    await systemMessage(
      n.id,
      n.version > 1
        ? `${name} sudah merevisi surat piutang${n.revisionNote ? ` sesuai permintaan "${n.revisionNote}"` : ""}. Versi ${n.version} siap dicek dan ditandatangani.`
        : `${name} mengirim surat piutang versi ${n.version} untuk ditandatangani.`,
      `/app/piutang/${n.id}`,
      user.id,
    );
    await audit(n.id, user.id, "SEND_FOR_SIGNATURE", `versi ${n.version}`);
    return ok();
  }

  if (body.action === "cancel") {
    const allowed =
      (isCreator && ["DRAFT", "PENDING_SIGNATURE"].includes(n.status)) || (role === "creditor" && n.status === "AWAITING_DISBURSEMENT");
    if (!allowed) throw new ApiError(409, "INVALID_STATUS", "Surat ini tidak bisa dibatalkan sekarang.");
    await db.note.update({ where: { id: n.id }, data: { status: "CANCELLED" } });
    await systemMessage(n.id, `${name} membatalkan surat piutang.` + (n.escrowTermsJson ? " Kreditur bisa menarik dana escrow di halaman detail." : ""), undefined, user.id);
    await audit(n.id, user.id, "CANCEL");
    return ok();
  }

  // Sengketa lewat 14 hari tanpa keputusan admin: pihak mana pun boleh menutupnya (tanpa hapus denda).
  if (body.action === "closeExpiredDispute") {
    if (!role) throw new ApiError(403, "FORBIDDEN", "Hanya pihak di surat ini yang bisa menutup sengketa.");
    if (n.status !== "DISPUTED") throw new ApiError(409, "INVALID_STATUS", "Surat ini tidak sedang sengketa.");
    const rc = await relay("Tutup sengketa kedaluwarsa", (c) => c.manager.closeExpiredDispute.populateTransaction(n.chainNoteId));
    await db.note.update({ where: { id: n.id }, data: { status: "ACTIVE" } });
    await systemMessage(n.id, `${name} menutup sengketa yang lewat 14 hari tanpa keputusan admin. Denda selama sengketa tetap terutang.`, undefined, user.id);
    await audit(n.id, user.id, "CLOSE_EXPIRED_DISPUTE", "", rc.hash);
    return ok({ txHash: rc.hash });
  }

  // reject / revise: hanya pihak lawan, saat menunggu tanda tangan
  if (isCreator || !role) throw new ApiError(403, "FORBIDDEN", "Hanya pihak yang diundang yang bisa menolak atau minta revisi.");
  if (n.status !== "PENDING_SIGNATURE") throw new ApiError(409, "INVALID_STATUS", "Surat ini tidak sedang menunggu tanda tangan.");

  if (body.action === "reject") {
    await db.note.update({ where: { id: n.id }, data: { status: "REJECTED", rejectReason: body.reason } });
    await systemMessage(n.id, `${name} menolak surat piutang: "${body.reason}"`, undefined, user.id);
    await audit(n.id, user.id, "REJECT", body.reason);
    return ok();
  }

  // revise: versi naik, semua tanda tangan versi lama otomatis tidak berlaku (BR-06)
  await db.note.update({
    where: { id: n.id },
    data: { status: "DRAFT", version: n.version + 1, termsJson: null, scheduleJson: null, noteHash: null, revisionNote: body.reason },
  });
  await systemMessage(n.id, `${name} minta revisi: "${body.reason}". Surat kembali ke draft dan tanda tangan versi ${n.version} dibatalkan.`, `/app/piutang/${n.id}`, user.id);
  await audit(n.id, user.id, "REQUEST_REVISION", body.reason);
  return ok();
});
