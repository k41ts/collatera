// Tanda tangan perjanjian (EIP-712) + setor escrow + aktivasi lewat relayer (BR-09 s.d. BR-16).
import { getAddress, hexlify, keccak256, randomBytes, toUtf8Bytes, verifyTypedData } from "ethers";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, handler, ok } from "@/lib/api";
import { audit, displayName, loadNote, requirePhone, roleOf, scheduleJsonOf, systemMessage, termsOf, type FullNote } from "@/lib/notes";
import { NOTE_TYPES, PERMIT_TYPES, RECEIPT_TYPES, managerDomain, tokenDomain } from "@/lib/chain/eip712";
import { ADDR } from "@/lib/chain/config";
import { reader, relay } from "@/lib/chain/relayer";
import { fmtRp } from "@/lib/money";

type Ctx = { params: Promise<{ id: string }> };

const escrowDone = (n: FullNote) => !!n.escrowTermsJson && n.escrowTermsJson === n.termsJson;
const sigOf = (n: FullNote, role: string) => n.signatures.find((s) => s.version === n.version && s.role === role)?.signature;

export const GET = handler<Ctx>(async (req, user, { params }) => {
  const n = await loadNote((await params).id, user);
  const role = roleOf(n, user);
  const kind = new URL(req.url).searchParams.get("kind") ?? "note";
  const terms = termsOf(n);
  if (!terms || !role) throw new ApiError(409, "INVALID_STATUS", "Surat ini belum siap ditandatangani.");

  if (kind === "receipt") {
    if (n.status !== "AWAITING_DISBURSEMENT" || role !== "debtor") throw new ApiError(409, "INVALID_STATUS", "Konfirmasi pencairan hanya untuk debitur.");
    return ok({
      domain: managerDomain,
      types: RECEIPT_TYPES,
      message: {
        noteHash: n.noteHash,
        proofHash: keccak256(toUtf8Bytes(`pencairan:${n.id}:v${n.version}`)),
        amount: terms.principal,
        nonce: BigInt(hexlify(randomBytes(32))).toString(),
        deadline: terms.deadline,
      },
    });
  }

  if (n.status !== "PENDING_SIGNATURE") throw new ApiError(409, "INVALID_STATUS", "Surat ini tidak sedang menunggu tanda tangan.");
  let permit = null;
  let balance: string | null = null;
  if (role === "creditor" && n.disbursement === "onchain" && !escrowDone(n)) {
    const { idrx } = reader();
    const [nonce, bal] = await Promise.all([idrx.nonces(user.wallet), idrx.balanceOf(user.wallet)]);
    balance = bal.toString();
    permit = {
      domain: tokenDomain,
      types: PERMIT_TYPES,
      message: { owner: user.wallet, spender: ADDR.DebtManager, value: terms.principal, nonce: nonce.toString(), deadline: String(terms.deadline) },
    };
  }
  return ok({ domain: managerDomain, types: NOTE_TYPES, message: terms, schedule: scheduleJsonOf(n), permit, balance, role });
});

const Body = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("note"),
    signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
    permit: z.object({ deadline: z.string(), v: z.number(), r: z.string(), s: z.string() }).optional(),
  }),
  z.object({
    kind: z.literal("receipt"),
    signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
    message: z.object({ noteHash: z.string(), proofHash: z.string(), amount: z.string(), nonce: z.string(), deadline: z.number() }),
  }),
]);

export const POST = handler<Ctx>(async (req, user, { params }) => {
  requirePhone(user);
  let n = await loadNote((await params).id, user);
  const role = roleOf(n, user);
  const terms = termsOf(n);
  const schedule = scheduleJsonOf(n);
  if (!terms || !schedule || !role) throw new ApiError(409, "INVALID_STATUS", "Surat ini belum siap ditandatangani.");
  const body = Body.parse(await req.json());
  const name = displayName(user);

  if (body.kind === "receipt") {
    if (n.status !== "AWAITING_DISBURSEMENT" || role !== "debtor") throw new ApiError(409, "INVALID_STATUS", "Konfirmasi pencairan hanya untuk debitur.");
    const m = body.message;
    if (m.noteHash !== n.noteHash || m.amount !== terms.principal || m.deadline !== terms.deadline || m.nonce === terms.debtorNonce)
      throw new ApiError(422, "RECEIPT_MISMATCH", "Data konfirmasi tidak cocok dengan surat.");
    if (getAddress(verifyTypedData(managerDomain, RECEIPT_TYPES, m, body.signature)) !== getAddress(terms.debtor))
      throw new ApiError(422, "SIGNATURE_INVALID", "Tanda tangan tidak valid untuk wallet debitur.");
    const rc = await relay("Aktivasi", (c) =>
      c.manager.activateOffchain.populateTransaction(terms, schedule, sigOf(n, "creditor"), sigOf(n, "debtor"), m, body.signature),
    );
    await db.note.update({ where: { id: n.id }, data: { status: "ACTIVE", activationTx: rc.hash, activatedAt: new Date() } });
    await systemMessage(n.id, `${name} mengonfirmasi dana ${fmtRp(terms.principal)} sudah diterima. Piutang aktif.`);
    await audit(n.id, user.id, "ACTIVATE_OFFCHAIN", "", rc.hash);
    return ok({ status: "ACTIVE", txHash: rc.hash });
  }

  if (n.status !== "PENDING_SIGNATURE") throw new ApiError(409, "INVALID_STATUS", "Surat ini tidak sedang menunggu tanda tangan.");
  const expected = role === "creditor" ? terms.creditor : terms.debtor;
  if (getAddress(user.wallet) !== getAddress(expected)) throw new ApiError(403, "WRONG_WALLET", "Wallet login berbeda dengan wallet di surat.");
  if (getAddress(verifyTypedData(managerDomain, NOTE_TYPES, terms, body.signature)) !== getAddress(expected))
    throw new ApiError(422, "SIGNATURE_INVALID", "Tanda tangan tidak valid.");

  // Kreditur + pencairan on-chain: setor pokok ke escrow saat tanda tangan.
  if (role === "creditor" && n.disbursement === "onchain" && !escrowDone(n)) {
    if (!body.permit) throw new ApiError(422, "PERMIT_REQUIRED", "Izin setor escrow (permit) belum ditandatangani.");
    const bal = await reader().idrx.balanceOf(user.wallet);
    if (bal < BigInt(terms.principal))
      throw new ApiError(422, "INSUFFICIENT_BALANCE", `Saldo IDRX kamu ${fmtRp(bal)}, kurang dari pokok ${fmtRp(terms.principal)}. Ambil dari faucet di Profil.`);
    const rc = await relay("Setor escrow", (c) => c.manager.depositEscrow.populateTransaction(terms, body.signature, body.permit));
    await db.note.update({ where: { id: n.id }, data: { escrowTx: rc.hash, escrowTermsJson: n.termsJson } });
    await systemMessage(n.id, `${name} menyetor ${fmtRp(terms.principal)} ke escrow.`);
    await audit(n.id, user.id, "DEPOSIT_ESCROW", "", rc.hash);
  }

  await db.signature.upsert({
    where: { noteId_version_role: { noteId: n.id, version: n.version, role } },
    update: { signature: body.signature, signerId: user.id },
    create: { noteId: n.id, version: n.version, role, signature: body.signature, signerId: user.id },
  });
  await systemMessage(n.id, `${name} menandatangani surat versi ${n.version}.`);
  await audit(n.id, user.id, "SIGN", `versi ${n.version} sebagai ${role}`);

  n = await loadNote(n.id, user);
  const sigC = sigOf(n, "creditor");
  const sigD = sigOf(n, "debtor");
  if (!sigC || !sigD) return ok({ status: n.status });

  if (n.disbursement === "offchain") {
    await db.note.update({ where: { id: n.id }, data: { status: "AWAITING_DISBURSEMENT" } });
    await systemMessage(n.id, "Kedua pihak sudah tanda tangan. Kreditur silakan transfer pokok, lalu debitur konfirmasi dana diterima.");
    return ok({ status: "AWAITING_DISBURSEMENT" });
  }
  if (!escrowDone(n)) return ok({ status: n.status, waiting: "Menunggu kreditur menyetor escrow." });

  const rc = await relay("Aktivasi", (c) => c.manager.activateOnchain.populateTransaction(terms, schedule, sigC, sigD));
  await db.note.update({
    where: { id: n.id },
    data: { status: "ACTIVE", activationTx: rc.hash, activatedAt: new Date(), escrowTermsJson: null },
  });
  await systemMessage(n.id, `Piutang aktif. Bukti digital terbit di wallet kreditur dan ${fmtRp(terms.principal)} cair ke debitur.`);
  await audit(n.id, null, "ACTIVATE_ONCHAIN", "", rc.hash);
  return ok({ status: "ACTIVE", txHash: rc.hash });
});
