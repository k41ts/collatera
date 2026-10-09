// Tes end-to-end API + kontrak di Sepolia tanpa MetaMask: dua wallet acak berperan sebagai kreditur & debitur,
// memanggil API persis seperti browser. Butuh dev server jalan (npm run dev) dan relayer ber-ETH.
//   node scripts/e2e-api.mjs [http://localhost:3000]
import fs from "node:fs";
import { Contract, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes, Interface } from "ethers";
import { PrismaClient } from "@prisma/client";

const BASE = process.argv[2] || "http://localhost:3000";
const dep = JSON.parse(fs.readFileSync(new URL("../src/lib/chain/deployment.json", import.meta.url), "utf8"));
const provider = new JsonRpcProvider("https://ethereum-sepolia-rpc.publicnode.com", dep.chainId, { staticNetwork: true });
const UNIT = 10n ** BigInt(dep.stablecoinDecimals);
const rp = (n) => (BigInt(n) * UNIT).toString();

const FORWARD_TYPES = { ForwardRequest: [
  { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "gas", type: "uint256" },
  { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint48" }, { name: "data", type: "bytes" }] };
const PERMIT_TYPES = { Permit: [
  { name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" },
  { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] };
const fwdDomain = { name: "PiutangForwarder", version: "1", chainId: dep.chainId, verifyingContract: dep.addresses.PiutangForwarder };
const tokDomain = { name: "Mock IDRX", version: "1", chainId: dep.chainId, verifyingContract: dep.addresses.MockIDRX };
const manager = new Interface(dep.abi.DebtManager);
const forwarder = new Contract(dep.addresses.PiutangForwarder, dep.abi.PiutangForwarder, provider);
const idrx = new Contract(dep.addresses.MockIDRX, dep.abi.MockIDRX, provider);

let step = 0;
const ok = (msg, extra = "") => console.log(`✓ ${String(++step).padStart(2, "0")} ${msg}${extra ? `  ${extra}` : ""}`);
function assert(cond, msg) { if (!cond) throw new Error(`✘ ${msg}`); }

class User {
  constructor(label) { this.label = label; this.wallet = Wallet.createRandom(); this.cookie = ""; }
  async req(method, path, json, form) {
    const res = await fetch(BASE + path, {
      method,
      headers: { ...(json ? { "Content-Type": "application/json" } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: json ? JSON.stringify(json) : form,
    });
    const sc = res.headers.get("set-cookie");
    if (sc) this.cookie = sc.split(";")[0];
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${this.label} ${method} ${path} → ${res.status} ${data?.error?.message ?? ""}`);
    return data;
  }
  async login(name) {
    const { nonce } = await this.req("POST", "/api/auth/nonce");
    const host = new URL(BASE).host;
    const message = [`${host} wants you to sign in with your Ethereum account:`, this.wallet.address, "", "Masuk ke PiutangChain.", "",
      `URI: ${BASE}`, "Version: 1", `Chain ID: ${dep.chainId}`, `Nonce: ${nonce}`, `Issued At: ${new Date().toISOString()}`].join("\n");
    await this.req("POST", "/api/auth/verify", { message, signature: await this.wallet.signMessage(message) });
    await this.req("PATCH", "/api/me", { name });
    const { devCode } = await this.req("POST", "/api/me/otp", { action: "send", phone: "+62812" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0") });
    await this.req("POST", "/api/me/otp", { action: "verify", code: devCode });
  }
  signTyped(t) { return this.wallet.signTypedData(t.domain, t.types, t.message); }
  async sign(noteId) {
    const t = await this.req("GET", `/api/notes/${noteId}/sign?kind=note`);
    const signature = await this.signTyped(t);
    let permit;
    if (t.permit) {
      const s = await this.signTyped(t.permit);
      permit = { deadline: String(t.permit.message.deadline), v: Number("0x" + s.slice(130, 132)), r: "0x" + s.slice(2, 66), s: "0x" + s.slice(66, 130) };
    }
    return this.req("POST", `/api/notes/${noteId}/sign`, { kind: "note", signature, permit });
  }
  async forward(noteId, fn, args, purpose, reason) {
    const request = { from: this.wallet.address, to: dep.addresses.DebtManager, gas: "900000",
      nonce: (await forwarder.nonces(this.wallet.address)).toString(), deadline: Math.floor(Date.now() / 1000) + 3600,
      data: manager.encodeFunctionData(fn, args) };
    const signature = await this.wallet.signTypedData(fwdDomain, FORWARD_TYPES, request);
    return this.req("POST", `/api/notes/${noteId}/forward`, { purpose, reason, request, signature });
  }
}

const note = (u, id) => u.req("GET", `/api/notes/${id}`);
const futureDate = (days) => new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
const pdf = () => new Blob([`%PDF-1.4\n% e2e ${Date.now()}\n`], { type: "application/pdf" });

async function main() {
  const K = new User("kreditur"), D = new User("debitur");
  await K.login("Andi Uji"); await D.login("Budi Uji");
  ok("login SIWE + verifikasi OTP dua user", `${K.wallet.address.slice(0, 8)} / ${D.wallet.address.slice(0, 8)}`);
  const f1 = await K.req("POST", "/api/faucet"); await D.req("POST", "/api/faucet");
  ok("faucet IDRX ke kedua wallet", f1.txHash);

  // ---------- Piutang 1: escrow on-chain ----------
  const { id } = await K.req("POST", "/api/notes", { role: "creditor", title: "E2E pinjaman renovasi", debtType: "personal", principal: "200000",
    interestType: "none", interestValue: "0", installmentCount: 2, firstDue: futureDate(40), lateFee: true, disbursement: "onchain",
    collateralNote: "", counterpartyWallet: D.wallet.address });
  const fd = new FormData(); fd.append("file", pdf(), "kuitansi.pdf");
  await K.req("POST", `/api/notes/${id}/documents`, null, fd);
  await K.req("POST", `/api/notes/${id}/action`, { action: "send" });
  ok("draft dibuat + dokumen + kirim untuk tanda tangan");
  let d = await note(D, id);
  assert(d.me.role === "debtor" && d.note.status === "PENDING_SIGNATURE", "debitur melihat surat");
  const s1 = await K.sign(id);
  d = await note(K, id);
  assert(d.note.escrowIsCurrent && d.note.creditorSigned, "escrow tersetor");
  ok("kreditur tanda tangan + setor escrow", d.note.escrowTx);
  const s2 = await D.sign(id);
  assert(s2.status === "ACTIVE", "aktif setelah dua tanda tangan");
  ok("debitur tanda tangan → aktif (mint + escrow cair)", s2.txHash);
  d = await note(D, id);
  assert(d.chain?.status === "ACTIVE", "status kontrak ACTIVE");

  // bayar on-chain lewat forwarder
  const amount = rp(100000);
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const pSig = await D.wallet.signTypedData(tokDomain, PERMIT_TYPES, { owner: D.wallet.address, spender: dep.addresses.DebtManager,
    value: amount, nonce: (await idrx.nonces(D.wallet.address)).toString(), deadline });
  const permit = { deadline, v: Number("0x" + pSig.slice(130, 132)), r: "0x" + pSig.slice(2, 66), s: "0x" + pSig.slice(66, 130) };
  const pay = await D.forward(id, "payOnchain", [d.note.chainNoteId, amount, 1, permit], "pay");
  ok("debitur bayar cicilan 1 on-chain (gasless, forwarder)", pay.txHash);

  // tolak forward yang dipakai untuk piutang lain
  try { await D.forward(id, "openDispute", ["0x" + "11".repeat(32), keccak256(toUtf8Bytes("alasan sengketa uji"))], "dispute", "alasan sengketa uji"); assert(false, "harus ditolak"); }
  catch (e) { assert(/piutang lain/.test(e.message), "pesan tolak forward: " + e.message); }
  ok("server menolak ForwardRequest untuk piutang lain");

  // bayar off-chain: upload bukti, kreditur konfirmasi dengan tanda tangan
  const pf = new FormData(); pf.append("amount", "50000"); pf.append("installment", "2"); pf.append("proof", pdf(), "bukti.pdf");
  const { id: pid } = await D.req("POST", `/api/notes/${id}/payments`, null, pf);
  const t = await K.req("GET", `/api/payments/${pid}`);
  const conf = await K.req("POST", `/api/payments/${pid}`, { action: "confirm", signature: await K.signTyped(t), message: t.message });
  d = await note(K, id);
  assert(BigInt(d.chain.remaining) === BigInt(rp(50000)), `sisa utang 50.000 (dapat ${d.chain.remaining})`);
  ok("bukti transfer dikonfirmasi kreditur, sisa Rp50.000", conf.txHash);

  await D.req("POST", `/api/notes/${id}/messages`, { body: "Halo, cicilan 2 sudah saya transfer sebagian." });
  const msgs = await K.req("GET", `/api/notes/${id}/messages`);
  assert(msgs.messages.some((m) => m.kind === "them") && msgs.messages.some((m) => m.kind === "event"), "chat + pesan sistem");
  ok("chat terkirim & pesan sistem tercatat", `${msgs.messages.length} pesan`);

  const ic = await K.req("POST", `/api/notes/${id}/integrity`);
  assert(ic.result === "VERIFIED", "integrity VERIFIED: " + JSON.stringify(ic.checks.filter((c) => !c.match)));
  ok("cek integritas: VERIFIED");

  const reason = "Transfer terakhir belum diakui";
  const disp = await D.forward(id, "openDispute", [d.note.chainNoteId, keccak256(toUtf8Bytes(reason))], "dispute", reason);
  d = await note(K, id);
  assert(d.chain.status === "DISPUTED", "status DISPUTED");
  ok("debitur ajukan sengketa (gasless) → DISPUTED", disp.txHash);

  const db = new PrismaClient();
  await db.note.update({ where: { id }, data: { principal: rp(900000) } });
  await db.$disconnect();
  const ic2 = await K.req("POST", `/api/notes/${id}/integrity`);
  d = await note(K, id);
  assert(ic2.result === "TAMPERED" && d.chain.status === "FROZEN", "tamper → FROZEN");
  ok("data DB diubah diam-diam → TAMPERED → FROZEN", ic2.freezeTx);

  // ---------- Piutang 2: pencairan off-chain + markPaid ----------
  const { id: id2 } = await D.req("POST", "/api/notes", { role: "debtor", title: "E2E modal katering", debtType: "business", principal: "150000",
    interestType: "percent", interestValue: "10", installmentCount: 1, firstDue: futureDate(35), lateFee: false, disbursement: "offchain",
    collateralNote: "", counterpartyWallet: K.wallet.address });
  await D.req("POST", `/api/notes/${id2}/action`, { action: "send" });
  await D.sign(id2);
  const s3 = await K.sign(id2);
  assert(s3.status === "AWAITING_DISBURSEMENT", "menunggu pencairan off-chain");
  ok("piutang 2 (debitur yang mengajukan, bunga 10%): dua tanda tangan → AWAITING_DISBURSEMENT");
  const rt = await D.req("GET", `/api/notes/${id2}/sign?kind=receipt`);
  const act = await D.req("POST", `/api/notes/${id2}/sign`, { kind: "receipt", signature: await D.signTyped(rt), message: rt.message });
  ok("debitur konfirmasi dana diterima → aktif", act.txHash);
  let d2 = await note(K, id2);
  assert(d2.chain.status === "ACTIVE" && d2.chain.remaining === rp(165000), `sisa Rp165.000 (dapat ${d2.chain?.remaining})`);
  const mp = await K.forward(id2, "markPaid", [d2.note.chainNoteId], "markPaid");
  d2 = await note(K, id2);
  assert(d2.note.status === "PAID", "PAID");
  ok("kreditur ikhlaskan sisa → PAID + burn", mp.txHash);

  console.log(`\nE2E LULUS (${step} langkah). Piutang: ${BASE}/app/piutang/${id} dan ${BASE}/app/piutang/${id2}`);
}

main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; });
