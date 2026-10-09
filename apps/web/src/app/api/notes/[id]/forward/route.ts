// Aksi pengguna gasless lewat PiutangForwarder (ERC-2771). Server memeriksa bahwa calldata yang
// ditandatangani benar-benar untuk aksi & piutang ini sebelum relayer mengirim (BE-13).
import { Interface, getAddress, keccak256, toUtf8Bytes } from "ethers";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, handler, ok } from "@/lib/api";
import { audit, displayName, loadNote, roleOf, systemMessage } from "@/lib/notes";
import { ABI, ADDR } from "@/lib/chain/config";
import { reader, relay } from "@/lib/chain/relayer";
import { fmtRp } from "@/lib/money";

type Ctx = { params: Promise<{ id: string }> };
const iface = new Interface(ABI.DebtManager);

const Body = z.object({
  purpose: z.enum(["pay", "dispute", "markPaid", "refund", "closeDispute", "unfreeze"]),
  reason: z.string().trim().max(500).optional(),
  request: z.object({
    from: z.string(),
    to: z.string(),
    gas: z.string().regex(/^\d+$/),
    nonce: z.string().regex(/^\d+$/),
    deadline: z.number().int(),
    data: z.string().regex(/^0x[0-9a-fA-F]*$/),
  }),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
});

const FN: Record<string, string> = {
  pay: "payOnchain",
  dispute: "openDispute",
  markPaid: "markPaid",
  refund: "refundEscrow",
  closeDispute: "closeDispute",
  unfreeze: "unfreeze",
};

export const POST = handler<Ctx>(async (req, user, { params }) => {
  const n = await loadNote((await params).id, user);
  const body = Body.parse(await req.json());
  const { request: r } = body;
  const role = roleOf(n, user);
  const bad = (msg: string) => new ApiError(422, "FORWARD_REQUEST_INVALID", msg);

  if (getAddress(r.from) !== getAddress(user.wallet)) throw bad("Permintaan harus ditandatangani wallet kamu sendiri.");
  if (getAddress(r.to) !== getAddress(ADDR.DebtManager)) throw bad("Tujuan permintaan bukan kontrak PiutangChain.");
  if (BigInt(r.gas) > BigInt(2_000_000)) throw bad("Batas gas terlalu besar.");
  const call = iface.parseTransaction({ data: r.data });
  if (!call || call.name !== FN[body.purpose]) throw bad("Aksi yang ditandatangani tidak sesuai.");

  const argNoteId = body.purpose === "refund" ? call.args[0].noteId : call.args[0];
  if (argNoteId !== n.chainNoteId) throw bad("Aksi yang ditandatangani untuk piutang lain.");

  switch (body.purpose) {
    case "pay":
      if (role !== "debtor") throw new ApiError(403, "FORBIDDEN", "Hanya debitur yang membayar.");
      break;
    case "dispute":
      if (!role) throw new ApiError(403, "FORBIDDEN", "Hanya pihak di surat ini yang bisa mengajukan sengketa.");
      if (!body.reason || body.reason.length < 10) throw new ApiError(422, "REASON_REQUIRED", "Jelaskan alasan sengketa (min. 10 huruf).");
      if (call.args[1] !== keccak256(toUtf8Bytes(body.reason))) throw bad("Alasan tidak cocok dengan yang ditandatangani.");
      break;
    case "markPaid":
    case "refund":
      if (role !== "creditor") throw new ApiError(403, "FORBIDDEN", "Hanya kreditur yang bisa melakukan ini.");
      if (body.purpose === "refund" && !n.escrowTermsJson) throw new ApiError(409, "NO_ESCROW", "Tidak ada dana escrow untuk ditarik.");
      break;
  }

  const { forwarder } = reader();
  if (!(await forwarder.verify(r, body.signature))) throw bad("Tanda tangan permintaan tidak valid atau kedaluwarsa.");

  const label = { pay: "Pembayaran", dispute: "Ajukan sengketa", markPaid: "Tandai lunas", refund: "Tarik escrow", closeDispute: "Tutup sengketa", unfreeze: "Buka pembekuan" }[body.purpose];
  const rc = await relay(label, (c) => c.forwarder.execute.populateTransaction(r, body.signature, { gasLimit: BigInt(r.gas) + BigInt(300_000) }));
  const name = displayName(user);

  if (body.purpose === "pay") {
    const ev = rc.logs
      .filter((l) => getAddress(l.address) === getAddress(ADDR.DebtManager))
      .map((l) => { try { return iface.parseLog(l); } catch { return null; } })
      .find((e) => e?.name === "PaymentRecorded");
    const amount = ev ? ev.args.amount.toString() : call.args[1].toString();
    await db.payment.create({
      data: { noteId: n.id, method: "onchain", amount, installment: Number(call.args[2]), status: "CONFIRMED", txHash: rc.hash },
    });
    await systemMessage(n.id, `${name} membayar ${fmtRp(amount)} dengan stablecoin.`);
  } else if (body.purpose === "dispute") {
    await db.note.update({ where: { id: n.id }, data: { status: "DISPUTED" } });
    await systemMessage(n.id, `${name} mengajukan sengketa: "${body.reason}". Admin akan meninjau.`);
  } else if (body.purpose === "markPaid") {
    await db.note.update({ where: { id: n.id }, data: { status: "PAID" } });
    await systemMessage(n.id, `${name} mengikhlaskan sisa utang. Piutang ditandai lunas.`);
  } else if (body.purpose === "refund") {
    await db.note.update({ where: { id: n.id }, data: { escrowTermsJson: null } });
    await systemMessage(n.id, `${name} menarik dana escrow. Tanda tangannya untuk versi itu ikut batal.`);
  } else {
    await systemMessage(n.id, body.purpose === "closeDispute" ? "Admin menutup sengketa." : "Admin membuka pembekuan piutang.");
  }
  await audit(n.id, user.id, body.purpose.toUpperCase(), body.reason ?? "", rc.hash);
  return ok({ txHash: rc.hash });
});
