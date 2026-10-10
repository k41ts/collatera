// Helper bersama untuk stress test: deploy, PRNG deterministik, aktivasi piutang, dan pembanding kontrak vs model.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const E = require("../../helpers/eip712");
const { NoteModel, S } = require("./model");

const DECIMALS = 2;
const IDR = (n) => BigInt(n) * 10n ** BigInt(DECIMALS);
const DAY = 86_400;
const NO_PERMIT = { deadline: 0, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash };
const ADMIN_ROLE = ethers.id("ADMIN_ROLE");
const FREEZER_ROLE = ethers.id("FREEZER_ROLE");
const START_BALANCE = IDR(1_000_000_000_000); // Rp1 triliun per pihak

/** Jumlah seed/langkah bisa dinaikkan: STRESS_SEEDS=200 STRESS_STEPS=150 npm run test:stress */
const SEEDS = Number(process.env.STRESS_SEEDS || 20);
const STEPS = Number(process.env.STRESS_STEPS || 60);
const BASE_SEED = Number(process.env.STRESS_SEED || 0x5eed);

/** PRNG mulberry32: deterministik, jadi seed yang gagal bisa diulang persis (STRESS_SEED=...). */
function prng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    big: (lo, hi) => {
      lo = BigInt(lo);
      hi = BigInt(hi);
      if (hi <= lo) return lo;
      const span = hi - lo + 1n;
      let v = 0n;
      for (let i = 0; i < 4; i++) v = (v << 32n) | BigInt(Math.floor(next() * 4294967296));
      return lo + (v % span);
    },
    weighted: (table) => {
      const total = table.reduce((s, [, w]) => s + w, 0);
      let x = next() * total;
      for (const [v, w] of table) if ((x -= w) < 0) return v;
      return table[table.length - 1][0];
    },
  };
  return r;
}

/** Deploy semua kontrak + `nParties` pihak bersaldo besar yang sudah approve DebtManager. */
async function deployStress(nParties = 8) {
  const signers = await ethers.getSigners();
  const [admin, relayer, freezer, stranger] = signers;
  const parties = signers.slice(4, 4 + nParties);
  const idrx = await ethers.deployContract("MockIDRX", [DECIMALS, admin.address, IDR(10_000_000)]);
  const forwarder = await ethers.deployContract("CollateraForwarder");
  const debtNote = await ethers.deployContract("DebtNote");
  const manager = await ethers.deployContract("DebtManager", [debtNote.target, idrx.target, forwarder.target, admin.address]);
  await forwarder.setManager(manager.target);
  await debtNote.setManager(manager.target);
  await manager.grantRole(FREEZER_ROLE, freezer.address);
  for (const p of parties) {
    await idrx.mint(p.address, START_BALANCE);
    await idrx.connect(p).approve(manager.target, ethers.MaxUint256);
  }
  const { chainId } = await ethers.provider.getNetwork();
  const domain = E.managerDomain(chainId, manager.target);
  return { signers, admin, relayer, freezer, stranger, parties, idrx, forwarder, debtNote, manager, chainId, domain };
}

let uniq = 0;
const nextId = (tag) => ethers.id(`${tag}-${++uniq}-${Date.now()}`);
const nextNonce = () => BigInt(ethers.hexlify(ethers.randomBytes(16)));

/** Jadwal acak: 1..maxN cicilan, jarak 1..maxGapDays hari, nominal acak, mulai setelah `from`. */
function randomSchedule(rng, from, { maxN = 24, maxGapDays = 45, minAmount = 1n, maxAmount = IDR(5_000_000) } = {}) {
  const n = rng.int(1, maxN);
  const dueDates = [];
  const amounts = [];
  let d = from;
  for (let i = 0; i < n; i++) {
    d += rng.int(1, maxGapDays) * DAY + rng.int(0, DAY - 1);
    dueDates.push(d);
    amounts.push(rng.big(minAmount, maxAmount));
  }
  return { dueDates, amounts };
}

/**
 * Buat dan aktifkan piutang (on-chain lewat escrow, atau off-chain lewat receipt debitur).
 * Mengembalikan { note, schedule, model }.
 */
async function openNote(ctx, { creditor, debtor, schedule, principal, lateFeeBps = 200, offchain = false }) {
  const now = await time.latest();
  const totalOwed = schedule.amounts.reduce((a, b) => a + BigInt(b), 0n);
  principal = principal ?? (totalOwed > 1n ? totalOwed - totalOwed / 10n : totalOwed);
  const note = {
    noteId: nextId("stress-note"),
    version: 1,
    creditor: creditor.address,
    debtor: debtor.address,
    docHash: nextId("stress-doc"),
    scheduleHash: E.scheduleHash(schedule),
    principal,
    totalOwed,
    lateFeeBps,
    dueDate: schedule.dueDates[schedule.dueDates.length - 1],
    disbursement: offchain ? 1 : 0,
    deadline: now + 7 * DAY,
    creditorNonce: nextNonce(),
    debtorNonce: nextNonce(),
  };
  const sigC = await creditor.signTypedData(ctx.domain, E.NOTE_TYPES, note);
  const sigD = await debtor.signTypedData(ctx.domain, E.NOTE_TYPES, note);
  if (offchain) {
    const receipt = {
      noteHash: E.noteStructHash(note),
      proofHash: nextId("stress-receipt"),
      amount: principal,
      nonce: nextNonce(),
      deadline: note.deadline,
    };
    const sigR = await debtor.signTypedData(ctx.domain, E.RECEIPT_TYPES, receipt);
    await ctx.manager.connect(ctx.relayer).activateOffchain(note, schedule, sigC, sigD, receipt, sigR);
  } else {
    await ctx.manager.connect(ctx.relayer).depositEscrow(note, sigC, NO_PERMIT);
    await ctx.manager.connect(ctx.relayer).activateOnchain(note, schedule, sigC, sigD);
  }
  const activatedAt = await time.latest();
  const model = new NoteModel({
    noteId: note.noteId,
    creditor,
    debtor,
    principal,
    dueDates: schedule.dueDates,
    amounts: schedule.amounts,
    lateFeeBps,
    activatedAt,
  });
  return { note, schedule, model };
}

/** Konfirmasi pembayaran off-chain yang ditandatangani kreditur. */
async function signPayment(ctx, creditor, noteId, amount, deadline) {
  const c = {
    noteId,
    amount,
    proofHash: nextId("stress-proof"),
    installmentIndex: 0,
    nonce: nextNonce(),
    deadline,
    settleFull: false,
  };
  const sig = await creditor.signTypedData(ctx.domain, E.PAYMENT_TYPES, c);
  return { c, sig };
}

/** Bandingkan SEMUA angka dan status kontrak dengan model pada waktu blok terakhir. */
async function expectMatches(ctx, m, label) {
  const t = BigInt(await time.latest());
  const { manager, debtNote } = ctx;
  const id = m.noteId;
  const ctxMsg = (what) => `${label}: ${what} (t=${t})`;
  const v = await manager.getNote(id);
  expect(v.scheduledPaid, ctxMsg("scheduledPaid")).to.equal(m.scheduledPaid);
  expect(v.paid, ctxMsg("paid")).to.equal(m.paid);
  expect(v.totalOwed, ctxMsg("totalOwed")).to.equal(m.totalOwed);
  expect(v.fullyPaid, ctxMsg("fullyPaid")).to.equal(m.fullyPaid);
  expect(v.version, ctxMsg("version")).to.equal(m.version);
  expect(await manager.remaining(id), ctxMsg("remaining")).to.equal(m.outstanding(t));
  expect(await manager.lateFeeOf(id), ctxMsg("lateFeeOf")).to.equal(m.lateFee(t));
  expect(await manager.overdueAmount(id), ctxMsg("overdueAmount")).to.equal(m.arrears(t));
  expect(await manager.statusOf(id), ctxMsg("statusOf")).to.equal(m.viewStatus(t));
  expect(await manager.requiredAmount(id), ctxMsg("requiredAmount")).to.equal(m.paid + m.outstanding(t));
  // Token ada selama belum PAID, dan selalu milik kreditur (non-transferable).
  const tokenId = BigInt(id);
  if (m.status === S.PAID) {
    await expect(debtNote.ownerOf(tokenId), ctxMsg("token harus sudah di-burn")).to.be.revertedWithCustomError(debtNote, "NonexistentToken");
  } else {
    expect(await debtNote.ownerOf(tokenId), ctxMsg("pemilik token")).to.equal(m.creditor.address);
  }
  // Invarian akuntansi.
  expect(m.scheduledPaid <= m.totalOwed, ctxMsg("scheduledPaid ≤ totalOwed")).to.equal(true);
  // Setiap rupiah yang dibayar tercatat ke cicilan atau denda (bisa lebih jika revisi menurunkan total).
  expect(m.scheduledPaid + m.feePaid <= m.paid, ctxMsg("cicilan + denda ≤ total dibayar")).to.equal(true);
}

module.exports = {
  ethers,
  time,
  expect,
  E,
  S,
  NoteModel,
  IDR,
  DAY,
  NO_PERMIT,
  ADMIN_ROLE,
  FREEZER_ROLE,
  START_BALANCE,
  SEEDS,
  STEPS,
  BASE_SEED,
  prng,
  deployStress,
  randomSchedule,
  openNote,
  signPayment,
  expectMatches,
  nextId,
  nextNonce,
};
