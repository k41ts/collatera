// Integrity checker (BR-26): hitung ulang docHash dari DB + file di storage, bandingkan dengan on-chain.
// Mismatch → TAMPERED → relayer (ADMIN/FREEZER_ROLE) membekukan piutang.
import { getAddress, keccak256, toUtf8Bytes } from "ethers";
import { db } from "@/lib/db";
import { ApiError, handler, ok } from "@/lib/api";
import { ACTIVE_LIKE, audit, loadNote, payloadOf, rehashDocuments, scheduleOf, systemMessage } from "@/lib/notes";
import { docHash, scheduleHash } from "@/lib/hash";
import { reader, relay } from "@/lib/chain/relayer";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handler<Ctx>(async (_req, user, { params }) => {
  const n = await loadNote((await params).id, user);
  if (!ACTIVE_LIKE.includes(n.status) || n.status === "PAID") throw new ApiError(409, "INVALID_STATUS", "Cek integritas untuk piutang yang sudah aktif.");

  const onchain = await reader().manager.getNote(n.chainNoteId);
  const sched = scheduleOf(n);
  const checks = [
    { label: "Hash dokumen & isi perjanjian", db: docHash(payloadOf(n, Number(onchain.version)), rehashDocuments(n)), chain: onchain.docHash },
    { label: "Jadwal cicilan", db: scheduleHash(sched.dueDates, sched.amounts), chain: onchain.scheduleHash },
    { label: "Nominal pokok", db: n.principal, chain: onchain.principal.toString() },
    { label: "Total utang", db: n.totalOwed, chain: onchain.totalOwed.toString() },
    { label: "Denda (bps)", db: String(n.lateFeeBps), chain: onchain.lateFeeBps.toString() },
    { label: "Kreditur", db: n.creditor ? getAddress(n.creditor.wallet) : "-", chain: getAddress(onchain.creditor) },
    { label: "Debitur", db: n.debtor ? getAddress(n.debtor.wallet) : "-", chain: getAddress(onchain.debtor) },
  ].map((c) => ({ ...c, match: c.db.toLowerCase() === String(c.chain).toLowerCase() }));
  const verified = checks.every((c) => c.match);

  let freezeTx: string | null = null;
  if (!verified && n.status !== "FROZEN") {
    const failed = checks.filter((c) => !c.match).map((c) => c.label).join(", ");
    const rc = await relay("Bekukan piutang", (c) => c.manager.freeze.populateTransaction(n.chainNoteId, keccak256(toUtf8Bytes(`TAMPERED: ${failed}`))));
    freezeTx = rc.hash;
    await db.note.update({ where: { id: n.id }, data: { status: "FROZEN", statusBeforeFreeze: n.status } });
    await systemMessage(n.id, `Cek integritas menemukan data yang berubah (${failed}). Piutang dibekukan sampai admin meninjau.`);
  }
  await db.note.update({ where: { id: n.id }, data: { integrity: verified ? "VERIFIED" : "TAMPERED", integrityAt: new Date() } });
  await audit(n.id, user.id, "INTEGRITY_CHECK", verified ? "VERIFIED" : "TAMPERED", freezeTx ?? undefined);
  return ok({ result: verified ? "VERIFIED" : "TAMPERED", checks, freezeTx });
});
