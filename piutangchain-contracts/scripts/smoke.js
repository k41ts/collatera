// Smoke test end-to-end terhadap kontrak yang sudah di-deploy (deployments/<network>.json).
//   npm run smoke:sepolia            (setelah npm run deploy:sepolia)
//   npx hardhat run scripts/smoke.js --network localhost
//
// Hanya butuh DEPLOYER_PRIVATE_KEY yang punya ETH: deployer berperan sebagai relayer (bayar semua gas) dan owner
// MockIDRX (mint saldo uji). Kreditur dan debitur adalah wallet acak sekali pakai yang HANYA menandatangani,
// jadi sekaligus membuktikan alur gasless: escrow lewat permit, aktivasi, bayar cicilan lewat PiutangForwarder,
// sampai PAID + burn.
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");
const E = require("../helpers/eip712");

const HOUR = 3600;

async function main() {
  const file = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(file)) throw new Error(`deployments/${network.name}.json tidak ada. Deploy dulu.`);
  const dep = JSON.parse(fs.readFileSync(file, "utf8"));
  const [relayer] = await ethers.getSigners();
  const chainId = BigInt(dep.chainId);
  const explorer = network.name === "sepolia" ? "https://sepolia.etherscan.io/tx/" : null;
  const IDR = (n) => BigInt(n) * 10n ** BigInt(dep.stablecoinDecimals);

  const idrx = await ethers.getContractAt("MockIDRX", dep.contracts.MockIDRX);
  const forwarder = await ethers.getContractAt("PiutangForwarder", dep.contracts.PiutangForwarder);
  const debtNote = await ethers.getContractAt("DebtNote", dep.contracts.DebtNote);
  const manager = await ethers.getContractAt("DebtManager", dep.contracts.DebtManager);

  const creditor = ethers.Wallet.createRandom();
  const debtor = ethers.Wallet.createRandom();
  console.log(`Network  : ${network.name} (chainId ${chainId})`);
  console.log(`Relayer  : ${relayer.address}  saldo ${ethers.formatEther(await ethers.provider.getBalance(relayer.address))} ETH`);
  console.log(`Kreditur : ${creditor.address} (wallet uji, tanpa ETH)`);
  console.log(`Debitur  : ${debtor.address} (wallet uji, tanpa ETH)\n`);

  const send = async (label, txPromise) => {
    const tx = await txPromise;
    const rc = await tx.wait();
    console.log(`✔ ${label}  gas ${rc.gasUsed}${explorer ? `  ${explorer}${tx.hash}` : `  ${tx.hash}`}`);
    return rc;
  };
  const latest = async () => (await ethers.provider.getBlock("latest")).timestamp;
  const rand = () => BigInt(ethers.hexlify(ethers.randomBytes(32)));

  // 1. Saldo uji
  const principal = IDR(200_000);
  await send("mint IDRX ke kreditur", idrx.connect(relayer).mint(creditor.address, principal));
  await send("mint IDRX ke debitur", idrx.connect(relayer).mint(debtor.address, principal));

  // 2. Perjanjian: 2 cicilan Rp100.000 (+1 jam, +2 jam), denda 2%/bulan
  const now = await latest();
  const schedule = { dueDates: [now + HOUR, now + 2 * HOUR], amounts: [IDR(100_000), IDR(100_000)] };
  const tag = `smoke-${Date.now()}`;
  const note = {
    noteId: ethers.id(tag),
    version: 1,
    creditor: creditor.address,
    debtor: debtor.address,
    docHash: ethers.id(`${tag}-doc`),
    scheduleHash: E.scheduleHash(schedule),
    principal,
    totalOwed: principal,
    lateFeeBps: 200,
    dueDate: schedule.dueDates[1],
    disbursement: 0,
    deadline: now + HOUR,
    creditorNonce: rand(),
    debtorNonce: rand(),
  };
  const mDomain = E.managerDomain(chainId, manager.target);
  const tDomain = E.tokenDomain(chainId, idrx.target);
  const fDomain = E.forwarderDomain(chainId, forwarder.target);

  const signPermit = async (owner, value, deadline) => {
    const nonce = await idrx.nonces(owner.address);
    const sig = await owner.signTypedData(tDomain, E.PERMIT_TYPES, {
      owner: owner.address, spender: manager.target, value, nonce, deadline,
    });
    return { deadline, ...E.splitSig(sig) };
  };

  // 3. Kreditur tanda tangan + setor escrow (gasless: permit)
  const sigC = await creditor.signTypedData(mDomain, E.NOTE_TYPES, note);
  const escrowPermit = await signPermit(creditor, principal, note.deadline);
  await send("depositEscrow", manager.connect(relayer).depositEscrow(note, sigC, escrowPermit));

  // 4. Debitur tanda tangan → aktivasi: mint ke kreditur, escrow cair ke debitur
  const sigD = await debtor.signTypedData(mDomain, E.NOTE_TYPES, note);
  await send("activateOnchain", manager.connect(relayer).activateOnchain(note, schedule, sigC, sigD));
  const tokenId = BigInt(note.noteId);
  await check("status ACTIVE", async () => (await manager.statusOf(note.noteId)) === 1n);
  await check("DebtNote dimiliki kreditur", async () => (await debtNote.ownerOf(tokenId)) === creditor.address);
  await check("debitur menerima pokok", async () => (await idrx.balanceOf(debtor.address)) === principal * 2n);
  await check("verifyHash cocok", async () => await manager.verifyHash(note.noteId, note.docHash));

  // 5. Debitur bayar lewat forwarder (gasless: permit + ForwardRequest)
  const payViaForwarder = async (label, amount, installmentIndex) => {
    const deadline = (await latest()) + HOUR;
    const permit = await signPermit(debtor, amount, deadline);
    const data = manager.interface.encodeFunctionData("payOnchain", [note.noteId, amount, installmentIndex, permit]);
    const req = { from: debtor.address, to: manager.target, gas: 800_000n, nonce: await forwarder.nonces(debtor.address), deadline, data };
    const sig = await debtor.signTypedData(fDomain, E.FORWARD_TYPES, req);
    if (!(await forwarder.verify(req, sig))) throw new Error("forwarder.verify gagal");
    await send(label, forwarder.connect(relayer).execute(req, sig, { gasLimit: 1_000_000n }));
  };
  await payViaForwarder("cicilan 1 lewat forwarder", IDR(100_000), 1);
  await check("sisa utang Rp100.000", async () => (await manager.remaining(note.noteId)) === IDR(100_000));
  // `amount` adalah batas maksimal: kirim lebih, contract hanya menarik sisa utang.
  await payViaForwarder("pelunasan lewat forwarder", IDR(150_000), 2);

  // 6. Lunas: PAID + burn
  await check("status PAID", async () => (await manager.statusOf(note.noteId)) === 3n);
  await check("sisa utang 0", async () => (await manager.remaining(note.noteId)) === 0n);
  await check("DebtNote di-burn", async () => await debtNote.ownerOf(tokenId).then(() => false, () => true));
  await check("kreditur menerima Rp200.000", async () => (await idrx.balanceOf(creditor.address)) === principal);
  await check("kreditur & debitur tidak pernah punya ETH", async () => (await ethers.provider.getBalance(creditor.address)) === 0n && (await ethers.provider.getBalance(debtor.address)) === 0n);

  console.log(`\nSmoke test LULUS. noteId ${note.noteId}`);
}

// RPC publik di-load-balance: pembacaan tepat setelah tx bisa datang dari node yang tertinggal satu-dua blok.
// Ulangi sebentar sebelum menyatakan gagal.
async function check(label, fn, tries = 10) {
  for (let i = 0; i < tries; i++) {
    if (await fn()) return console.log(`  ✓ ${label}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`✘ ${label}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
