// Aksi pengguna gasless lewat CollateraForwarder (ERC-2771). Server memeriksa bahwa calldata yang
// ditandatangani benar-benar untuk aksi & piutang ini sebelum relayer mengirim (BE-13).
import { Interface, Signature, getAddress, keccak256, toUtf8Bytes, verifyTypedData } from "ethers";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, handler, ok } from "@/lib/api";
import { audit, displayName, loadNote, roleOf, systemMessage } from "@/lib/notes";
import { ABI, ADDR } from "@/lib/chain/config";
import { chain, reader, relay } from "@/lib/chain/relayer";
import { PERMIT_TYPES, tokenDomain } from "@/lib/chain/eip712";
import { feeFor } from "@/lib/appFee";
import { appFeeConfig } from "@/lib/appFeeConfig";
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
  // Izin (permit IDRX) dari debitur agar relayer bisa menarik fee aplikasi setelah pembayaran berhasil.
  fee: z
    .object({ value: z.string().regex(/^\d+$/), deadline: z.number().int(), signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) })
    .optional(),
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
  if (getAddress(r.to) !== getAddress(ADDR.DebtManager)) throw bad("Tujuan permintaan bukan kontrak Collatera.");
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
    case "closeDispute":
      if (!body.reason) throw new ApiError(422, "REASON_REQUIRED", "Tulis ringkasan keputusan.");
      if (call.args[1] !== keccak256(toUtf8Bytes(body.reason))) throw bad("Ringkasan tidak cocok dengan yang ditandatangani.");
      break;
    case "markPaid":
    case "refund":
      if (role !== "creditor") throw new ApiError(403, "FORBIDDEN", "Hanya kreditur yang bisa melakukan ini.");
      if (body.purpose === "refund" && !n.escrowTermsJson) throw new ApiError(409, "NO_ESCROW", "Tidak ada dana escrow untuk ditarik.");
      break;
  }

  const { forwarder, idrx } = reader();
  if (!(await forwarder.verify(r, body.signature))) throw bad("Tanda tangan permintaan tidak valid atau kedaluwarsa.");

  // Fee aplikasi: diperiksa SEBELUM pembayaran dikirim supaya debitur tidak bisa membayar tanpa fee.
  const appFee = body.purpose === "pay" ? appFeeConfig() : null;
  if (appFee) {
    const maxAmount = BigInt(call.args[1].toString());
    const maxFee = feeFor(maxAmount, appFee.bps);
    if (!body.fee) throw bad("Izin pembayaran fee aplikasi belum ditandatangani. Muat ulang halaman lalu coba lagi.");
    if (BigInt(body.fee.value) < maxFee) throw bad("Izin fee aplikasi kurang dari tarif yang berlaku.");
    if (body.fee.deadline < Math.floor(Date.now() / 1000) + 300) throw bad("Izin fee aplikasi sudah/hampir kedaluwarsa.");
    // Permit pembayaran memakai nonce IDRX sekarang; permit fee memakai nonce berikutnya.
    const nonce = (await idrx.nonces(user.wallet)) as bigint;
    const signer = verifyTypedData(
      tokenDomain,
      PERMIT_TYPES,
      { owner: user.wallet, spender: chain().address, value: body.fee.value, nonce: nonce + BigInt(1), deadline: body.fee.deadline },
      body.fee.signature,
    );
    if (getAddress(signer) !== getAddress(user.wallet)) throw bad("Tanda tangan izin fee aplikasi tidak valid.");
    const balance = (await idrx.balanceOf(user.wallet)) as bigint;
    if (balance < maxAmount + maxFee) throw bad(`Saldo IDRX tidak cukup untuk pembayaran + fee aplikasi ${fmtRp(maxFee)}.`);
  }

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
    // Tarik fee aplikasi dari debitur ke wallet fee, dihitung dari jumlah yang benar-benar terbayar.
    let feeNote = "";
    if (appFee && body.fee) {
      const fee = feeFor(BigInt(amount), appFee.bps);
      try {
        const sig = Signature.from(body.fee.signature);
        await relay("Fee aplikasi (izin)", (c) => c.idrx.permit.populateTransaction(user.wallet, c.address, body.fee!.value, body.fee!.deadline, sig.v, sig.r, sig.s));
        const feeRc = await relay("Fee aplikasi", (c) => c.idrx.transferFrom.populateTransaction(user.wallet, appFee.wallet, fee));
        await audit(n.id, user.id, "APP_FEE", `${fmtRp(fee.toString())} (${appFee.bps / 100}%) ke ${appFee.wallet}`, feeRc.hash);
        feeNote = ` (+ fee aplikasi ${fmtRp(fee.toString())})`;
      } catch (e) {
        // Pembayaran ke kreditur sudah sah di blockchain; fee yang gagal ditarik dicatat untuk ditagih ulang.
        console.error("APP_FEE gagal", e);
        await audit(n.id, user.id, "APP_FEE_FAILED", `${fmtRp(fee.toString())}: ${(e as Error).message.slice(0, 200)}`);
      }
    }
    await systemMessage(n.id, `${name} membayar ${fmtRp(amount)} dengan stablecoin${feeNote}.`, undefined, user.id);
  } else if (body.purpose === "dispute") {
    await db.note.update({ where: { id: n.id }, data: { status: "DISPUTED" } });
    await systemMessage(n.id, `${name} mengajukan sengketa: "${body.reason}". Admin akan meninjau.`, undefined, user.id);
  } else if (body.purpose === "markPaid") {
    await db.note.update({ where: { id: n.id }, data: { status: "PAID" } });
    await systemMessage(n.id, `${name} mengikhlaskan sisa utang. Piutang ditandai lunas.`, undefined, user.id);
  } else if (body.purpose === "refund") {
    await db.note.update({ where: { id: n.id }, data: { escrowTermsJson: null } });
    await systemMessage(n.id, `${name} menarik dana escrow. Tanda tangannya untuk versi itu ikut batal.`, undefined, user.id);
  } else {
    const closeText = `Admin menutup sengketa: "${body.reason}".` + (call.args[2] ? " Denda selama sengketa dihapus." : " Denda selama sengketa tetap terutang.");
    await systemMessage(n.id, body.purpose === "closeDispute" ? closeText : "Admin membuka pembekuan piutang.", undefined, user.id);
  }
  await audit(n.id, user.id, body.purpose.toUpperCase(), body.reason ?? "", rc.hash);
  return ok({ txHash: rc.hash });
});
