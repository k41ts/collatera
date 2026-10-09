// Logika domain surat piutang di server (docs/03-BUSINESS-RULES.md).
import { hexlify, randomBytes } from "ethers";
import { db } from "./db";
import { ApiError } from "./api";
import type { SessionUser } from "./session";
import { CHAIN_STATUS } from "./chain/config";
import type { NoteTerms, Schedule } from "./chain/eip712";
import { docHash, fileHash, scheduleHash } from "./hash";
import { reader } from "./chain/relayer";

export const DAY = 86400;
export const ACTIVE_LIKE = ["ACTIVE", "OVERDUE", "DISPUTED", "FROZEN", "PAID"];

export const noteInclude = {
  creator: true,
  creditor: true,
  debtor: true,
  installments: { orderBy: { seq: "asc" as const } },
  // tanpa kolom data (isi file) supaya setiap request tidak menarik sampai 20 MB
  documents: { orderBy: { createdAt: "asc" as const }, select: { id: true, noteId: true, name: true, mime: true, size: true, fileHash: true, createdAt: true } },
  signatures: true,
  // tanpa isi file bukti transfer; diambil terpisah lewat /api/files/proof/[id]
  payments: { orderBy: { createdAt: "desc" as const }, omit: { proofData: true } },
  events: { orderBy: { createdAt: "desc" as const }, take: 30 },
};

export async function loadNote(id: string, user: SessionUser) {
  const note = await db.note.findUnique({ where: { id }, include: noteInclude });
  if (!note) throw new ApiError(404, "NOT_FOUND", "Surat piutang tidak ditemukan.");
  if (!canAccess(note, user)) throw new ApiError(403, "FORBIDDEN", "Kamu bukan pihak di surat piutang ini.");
  return note;
}
export type FullNote = Awaited<ReturnType<typeof loadNote>>;

type Parties = { creatorId: string; creditorId: string | null; debtorId: string | null; counterpartyWallet: string | null };

export function canAccess(n: Parties, u: SessionUser) {
  return (
    n.creatorId === u.id ||
    n.creditorId === u.id ||
    n.debtorId === u.id ||
    (!!n.counterpartyWallet && n.counterpartyWallet.toLowerCase() === u.wallet.toLowerCase())
  );
}

/** Peran user di piutang ini; pihak yang diundang lewat wallet dianggap sudah punya peran lawan. */
export function roleOf(n: Parties & { creatorRole: string }, u: SessionUser): "creditor" | "debtor" | null {
  if (n.creditorId === u.id) return "creditor";
  if (n.debtorId === u.id) return "debtor";
  if (n.counterpartyWallet && n.counterpartyWallet.toLowerCase() === u.wallet.toLowerCase())
    return n.creatorRole === "creditor" ? "debtor" : "creditor";
  return null;
}

/** Pihak lawan yang diundang lewat wallet otomatis "bergabung" saat pertama kali membuka surat. */
export async function joinIfInvited(n: FullNote, u: SessionUser) {
  const r = roleOf(n, u);
  if (!r || n.creatorId === u.id) return n;
  if (r === "creditor" && !n.creditorId) await db.note.update({ where: { id: n.id }, data: { creditorId: u.id } });
  else if (r === "debtor" && !n.debtorId) await db.note.update({ where: { id: n.id }, data: { debtorId: u.id } });
  else return n;
  await systemMessage(n.id, `${displayName(u)} bergabung sebagai ${r === "creditor" ? "kreditur" : "debitur"}.`, undefined, u.id);
  return loadNote(n.id, u);
}

export const displayName = (u: { name: string | null; wallet: string } | null | undefined) =>
  u ? u.name?.trim() || `${u.wallet.slice(0, 6)}…${u.wallet.slice(-4)}` : "Pihak lawan";

/**
 * Pesan sistem di chat surat. `actorId` = user yang memicu kejadian ini: kalau dia sudah membaca semua pesan
 * sebelumnya, pesan ini langsung dianggap terbaca olehnya (yang jadi "belum dibaca" hanya pihak lawan).
 */
export async function systemMessage(noteId: string, body: string, link?: string, actorId?: string) {
  const prev = actorId ? await db.message.findFirst({ where: { noteId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }) : null;
  const m = await db.message.create({ data: { noteId, body, link } });
  if (!actorId) return;
  const read = await db.chatRead.findUnique({ where: { userId_noteId: { userId: actorId, noteId } } });
  if (prev && (!read || read.readAt < prev.createdAt)) return;
  await db.chatRead.upsert({
    where: { userId_noteId: { userId: actorId, noteId } },
    update: { readAt: m.createdAt },
    create: { userId: actorId, noteId, readAt: m.createdAt },
  });
}

export async function audit(noteId: string | null, actorId: string | null, action: string, detail = "", txHash?: string) {
  await db.auditLog.create({ data: { noteId, actorId, action, detail, txHash } });
}

/** 00:00 WIB tanggal itu, dalam detik unix. */
export function wibMidnight(date: Date): number {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 1000) - 7 * 3600;
}

export function computeTotal(principal: bigint, interestType: string, interestValue: string, unit: bigint): bigint {
  if (interestType === "percent") return principal + (principal * BigInt(Math.round(Number(interestValue) * 100))) / BigInt(10000);
  if (interestType === "flat") return principal + BigInt(interestValue || "0") * unit;
  return principal;
}

/** Bagi total ke n cicilan bulanan; sisa pembagian masuk cicilan terakhir. */
export function splitInstallments(total: bigint, count: number, firstDue: Date) {
  const base = total / BigInt(count);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(firstDue.getUTCFullYear(), firstDue.getUTCMonth() + i, firstDue.getUTCDate()));
    return { seq: i + 1, dueDate: d, amount: (i === count - 1 ? total - base * BigInt(count - 1) : base).toString() };
  });
}

/** Hitung ulang hash dari isi file yang tersimpan (bukan dari kolom fileHash) supaya penggantian file terdeteksi. */
export async function rehashDocuments(n: FullNote): Promise<string[]> {
  const docs = await db.document.findMany({ where: { noteId: n.id }, orderBy: { createdAt: "asc" }, select: { data: true } });
  return docs.map((d) => fileHash(d.data));
}

export function payloadOf(n: FullNote, version = n.version) {
  return {
    noteId: n.chainNoteId,
    title: n.title,
    debtType: n.debtType,
    interestType: n.interestType,
    interestValue: n.interestValue,
    collateralNote: n.collateralNote,
    disbursement: n.disbursement,
    version,
  };
}

export function scheduleOf(n: FullNote): Schedule {
  return { dueDates: n.installments.map((i) => wibMidnight(i.dueDate)), amounts: n.installments.map((i) => i.amount) };
}

const randNonce = () => BigInt(hexlify(randomBytes(32))).toString();

/** Bangun struct Note untuk versi yang akan ditandatangani. */
export function buildTerms(n: FullNote, creditorWallet: string, debtorWallet: string): { terms: NoteTerms; schedule: Schedule } {
  const schedule = scheduleOf(n);
  const now = Math.floor(Date.now() / 1000);
  if (schedule.dueDates[0] <= now + 3600) throw new ApiError(422, "INVALID_SCHEDULE", "Jatuh tempo cicilan pertama harus di masa depan.");
  const terms: NoteTerms = {
    noteId: n.chainNoteId,
    version: n.version,
    creditor: creditorWallet,
    debtor: debtorWallet,
    docHash: docHash(payloadOf(n), n.documents.map((d) => d.fileHash)),
    scheduleHash: scheduleHash(schedule.dueDates, schedule.amounts),
    principal: n.principal,
    totalOwed: n.totalOwed,
    lateFeeBps: n.lateFeeBps,
    dueDate: schedule.dueDates[schedule.dueDates.length - 1],
    disbursement: n.disbursement === "onchain" ? 0 : 1,
    deadline: now + (n.disbursement === "onchain" ? 7 : 14) * DAY,
    creditorNonce: randNonce(),
    debtorNonce: randNonce(),
  };
  return { terms, schedule };
}

export const termsOf = (n: { termsJson: string | null }) => (n.termsJson ? (JSON.parse(n.termsJson) as NoteTerms) : null);
export const scheduleJsonOf = (n: { scheduleJson: string | null }) => (n.scheduleJson ? (JSON.parse(n.scheduleJson) as Schedule) : null);

export type ChainView = {
  status: string;
  remaining: string;
  paid: string;
  scheduledPaid: string;
  lateFee: string;
  overdue: string;
  fullyPaid: boolean;
  docHash: string;
  principal: string;
  totalOwed: string;
  scheduleHash: string;
};

/** Baca status kontrak dan samakan status DB (kontrak adalah sumber kebenaran sejak aktif). */
export async function syncFromChain(n: FullNote): Promise<ChainView | null> {
  if (!ACTIVE_LIKE.includes(n.status)) return null;
  const { manager } = reader();
  try {
    const [v, st, rem, fee, od] = await Promise.all([
      manager.getNote(n.chainNoteId),
      manager.statusOf(n.chainNoteId),
      manager.remaining(n.chainNoteId),
      manager.lateFeeOf(n.chainNoteId),
      manager.overdueAmount(n.chainNoteId),
    ]);
    const status = CHAIN_STATUS[Number(st)];
    if (status !== "NONE" && status !== n.status) {
      await db.note.update({ where: { id: n.id }, data: { status } });
      if (status === "OVERDUE") await systemMessage(n.id, "Ada cicilan lewat jatuh tempo. Status piutang menjadi OVERDUE.");
      if (status === "PAID") await systemMessage(n.id, "Lunas. Bukti digital di-burn dan bukti lunas tercatat di blockchain.");
    }
    return {
      status,
      remaining: rem.toString(),
      paid: v.paid.toString(),
      scheduledPaid: v.scheduledPaid.toString(),
      lateFee: fee.toString(),
      overdue: od.toString(),
      fullyPaid: v.fullyPaid,
      docHash: v.docHash,
      principal: v.principal.toString(),
      totalOwed: v.totalOwed.toString(),
      scheduleHash: v.scheduleHash,
    };
  } catch (e) {
    if (n.status === "PAID") return null;
    console.error("syncFromChain", e);
    return null;
  }
}

export function requirePhone(u: SessionUser) {
  if (!u.phoneVerifiedAt) throw new ApiError(403, "PHONE_NOT_VERIFIED", "Verifikasi nomor HP dulu di halaman Profil.");
}
