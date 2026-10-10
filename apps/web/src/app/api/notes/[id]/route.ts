import { id as keccakId } from "ethers";
import { db } from "@/lib/db";
import { ApiError, handler, ok } from "@/lib/api";
import { NoteInput, deriveNoteFields } from "@/lib/noteInput";
import { audit, displayName, joinIfInvited, loadNote, roleOf, syncFromChain, termsOf } from "@/lib/notes";
import { reader } from "@/lib/chain/relayer";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler<Ctx>(async (_req, user, { params }) => {
  let n = await loadNote((await params).id, user);
  n = await joinIfInvited(n, user);
  const chainView = await syncFromChain(n);
  if (chainView) n = await loadNote(n.id, user);
  const role = roleOf(n, user);

  let isAdmin = false;
  if (["DISPUTED", "FROZEN"].includes(n.status)) {
    try {
      isAdmin = await reader().manager.hasRole(keccakId("ADMIN_ROLE"), user.wallet);
    } catch {
      /* abaikan */
    }
  }

  const sig = (r: string) => n.signatures.find((s) => s.version === n.version && s.role === r);
  const otherUser = role === "creditor" ? n.debtor : n.creditor;
  return ok({
    note: {
      id: n.id,
      code: "PC-" + n.chainNoteId.slice(2, 6).toUpperCase(),
      chainNoteId: n.chainNoteId,
      inviteToken: n.creatorId === user.id ? n.inviteToken : undefined,
      version: n.version,
      status: n.status,
      creatorRole: n.creatorRole,
      title: n.title,
      debtType: n.debtType,
      principal: n.principal,
      interestType: n.interestType,
      interestValue: n.interestValue,
      totalOwed: n.totalOwed,
      lateFeeBps: n.lateFeeBps,
      disbursement: n.disbursement,
      collateralNote: n.collateralNote,
      counterpartyWallet: n.counterpartyWallet,
      rejectReason: n.rejectReason,
      revisionNote: n.revisionNote,
      escrowTx: n.escrowTx,
      // struct Note yang dananya masih tertahan di escrow; dipakai kreditur untuk refundEscrow
      escrowTerms: role === "creditor" && n.escrowTermsJson && n.status !== "ACTIVE" ? JSON.parse(n.escrowTermsJson) : null,
      escrowIsCurrent: !!n.escrowTermsJson && n.escrowTermsJson === n.termsJson,
      activationTx: n.activationTx,
      activatedAt: n.activatedAt,
      docHash: n.docHash,
      integrity: n.integrity,
      integrityAt: n.integrityAt,
      createdAt: n.createdAt,
      terms: termsOf(n),
      installments: n.installments.map((i) => ({ seq: i.seq, dueDate: i.dueDate, amount: i.amount })),
      documents: n.documents.map((d) => ({ id: d.id, name: d.name, size: d.size, mime: d.mime, fileHash: d.fileHash })),
      payments: n.payments.map((p) => ({
        id: p.id, method: p.method, amount: p.amount, installment: p.installment, status: p.status,
        proofName: p.proofName, rejectReason: p.rejectReason, txHash: p.txHash, createdAt: p.createdAt,
      })),
      events: n.events.map((e) => ({ action: e.action, detail: e.detail, txHash: e.txHash, createdAt: e.createdAt })),
      creditor: n.creditor ? { name: displayName(n.creditor), wallet: n.creditor.wallet } : null,
      debtor: n.debtor ? { name: displayName(n.debtor), wallet: n.debtor.wallet } : null,
      creditorSigned: !!sig("creditor"),
      debtorSigned: !!sig("debtor"),
    },
    me: { role, isCreator: n.creatorId === user.id, isAdmin, wallet: user.wallet, phoneVerified: !!user.phoneVerifiedAt },
    other: otherUser ? { name: displayName(otherUser), wallet: otherUser.wallet } : null,
    chain: chainView,
  });
});

/** Ubah draft (hanya pembuat, hanya saat DRAFT). */
export const PATCH = handler<Ctx>(async (req, user, { params }) => {
  const n = await loadNote((await params).id, user);
  if (n.creatorId !== user.id) throw new ApiError(403, "FORBIDDEN", "Hanya pembuat draft yang bisa mengubahnya.");
  if (n.status !== "DRAFT") throw new ApiError(409, "INVALID_STATUS", "Draft hanya bisa diubah sebelum dikirim untuk tanda tangan.");
  const input = NoteInput.parse({ ...(await req.json()), role: n.creatorRole });
  const { fields, installments } = deriveNoteFields(input);
  if (fields.counterpartyWallet.toLowerCase() === user.wallet.toLowerCase())
    throw new ApiError(422, "INVALID_PARTIES", "Pihak lawan tidak boleh wallet kamu sendiri.");
  // Wallet pihak lawan dikunci sejak draft dibuat (dia mungkin sudah bergabung / membuka surat ini).
  if (n.counterpartyWallet && fields.counterpartyWallet.toLowerCase() !== n.counterpartyWallet.toLowerCase())
    throw new ApiError(422, "COUNTERPARTY_LOCKED", "Wallet pihak lawan tidak bisa diubah. Batalkan draft ini lalu buat surat baru.");
  const other = await db.user.findUnique({ where: { wallet: fields.counterpartyWallet } });
  await db.$transaction([
    db.installment.deleteMany({ where: { noteId: n.id } }),
    db.note.update({
      where: { id: n.id },
      data: {
        ...fields,
        creditorId: n.creatorRole === "creditor" ? user.id : other?.id ?? null,
        debtorId: n.creatorRole === "debtor" ? user.id : other?.id ?? null,
        installments: { create: installments },
      },
    }),
  ]);
  await audit(n.id, user.id, "EDIT_DRAFT");
  return ok({ id: n.id });
});
