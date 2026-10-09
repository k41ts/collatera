import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { ApiError, handler, ok } from "@/lib/api";
import { NoteInput, deriveNoteFields } from "@/lib/noteInput";
import { audit, displayName, requirePhone, roleOf, systemMessage } from "@/lib/notes";
import { chainNoteId } from "@/lib/hash";

export const GET = handler(async (_req, user) => {
  const notes = await db.note.findMany({
    where: { OR: [{ creatorId: user.id }, { creditorId: user.id }, { debtorId: user.id }, { counterpartyWallet: user.wallet }] },
    include: {
      creator: true,
      creditor: true,
      debtor: true,
      installments: { orderBy: { seq: "asc" } },
      payments: { where: { status: "CONFIRMED" }, select: { amount: true } },
      signatures: true,
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
  });
  // Jumlah pesan belum dibaca semua surat dalam satu query (bukan satu query per surat).
  const ids = notes.map((n) => n.id);
  const unreadRows = ids.length
    ? await db.$queryRaw<{ noteId: string; n: number }[]>`
        SELECT m."noteId", COUNT(*)::int AS n
        FROM "Message" m
        LEFT JOIN "ChatRead" r ON r."noteId" = m."noteId" AND r."userId" = ${user.id}
        WHERE m."noteId" = ANY(${ids}) AND COALESCE(m."senderId", '') <> ${user.id} AND m."createdAt" > COALESCE(r."readAt", 'epoch'::timestamp)
        GROUP BY m."noteId"`
    : [];
  const unreadOf = new Map(unreadRows.map((r) => [r.noteId, r.n]));

  const items = notes.map((n) => {
      const role = roleOf(n, user);
      const other = role === "creditor" ? n.debtor : n.creditor;
      // PAID bisa lewat markPaid (sisa diikhlaskan) tanpa catatan pembayaran: anggap lunas penuh.
      const paid = n.status === "PAID" ? BigInt(n.totalOwed) : n.payments.reduce((s, p) => s + BigInt(p.amount), BigInt(0));
      let cum = BigInt(0);
      const next = n.installments.find((i) => (cum += BigInt(i.amount)) > paid);
      const unread = unreadOf.get(n.id) ?? 0;
      const mySig = n.signatures.some((s) => s.version === n.version && s.signerId === user.id && s.role !== "receipt");
      const isCreator = n.creatorId === user.id;
      // Status revisi untuk notifikasi di daftar & menu: diminta (pembuat perlu memperbaiki), sedang dikerjakan, atau sudah direvisi.
      const revision =
        n.status === "DRAFT" && n.revisionNote ? (isCreator ? "requested" : "in_progress")
        : n.status === "PENDING_SIGNATURE" && n.version > 1 && !isCreator ? (mySig ? null : "done")
        : null;
      return {
        id: n.id,
        code: "PC-" + n.chainNoteId.slice(2, 6).toUpperCase(),
        title: n.title,
        debtType: n.debtType,
        status: n.status,
        role,
        party: other ? displayName(other) : n.counterpartyWallet ? `${n.counterpartyWallet.slice(0, 6)}…${n.counterpartyWallet.slice(-4)}` : "Belum ada",
        totalOwed: n.totalOwed,
        principal: n.principal,
        paid: paid.toString(),
        installmentCount: n.installments.length,
        paidInstallments: n.installments.filter((_, i) => n.installments.slice(0, i + 1).reduce((s, x) => s + BigInt(x.amount), BigInt(0)) <= paid).length,
        nextDue: next?.dueDate ?? null,
        disbursement: n.disbursement,
        lateFeeBps: n.lateFeeBps,
        version: n.version,
        mySignature: mySig,
        isCreator,
        revision,
        revisionNote: n.revisionNote,
        documents: 0,
        lastMessage: n.messages[0]?.body ?? null,
        lastMessageAt: n.messages[0]?.createdAt ?? null,
        unread,
        updatedAt: n.updatedAt,
      };
  });
  return ok({ notes: items });
});

export const POST = handler(async (req, user) => {
  requirePhone(user);
  const input = NoteInput.parse(await req.json());
  const { fields, installments } = deriveNoteFields(input);
  if (fields.counterpartyWallet.toLowerCase() === user.wallet.toLowerCase())
    throw new ApiError(422, "INVALID_PARTIES", "Pihak lawan tidak boleh wallet kamu sendiri.");

  const other = await db.user.findUnique({ where: { wallet: fields.counterpartyWallet } });
  const id = randomUUID();
  const note = await db.note.create({
    data: {
      id,
      chainNoteId: chainNoteId(id),
      inviteToken: randomUUID().replace(/-/g, ""),
      creatorRole: input.role,
      creatorId: user.id,
      creditorId: input.role === "creditor" ? user.id : other?.id ?? null,
      debtorId: input.role === "debtor" ? user.id : other?.id ?? null,
      ...fields,
      installments: { create: installments },
    },
  });
  await systemMessage(note.id, `${displayName(user)} membuat draft surat piutang.`, undefined, user.id);
  await audit(note.id, user.id, "CREATE_DRAFT");
  return ok({ id: note.id }, 201);
});
