const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const E = require("../helpers/eip712");

const DECIMALS = 2;
const IDR = (n) => BigInt(n) * 10n ** BigInt(DECIMALS); // Rp n dalam satuan terkecil
const DAY = 86400;
const NO_PERMIT = { deadline: 0, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash };

const ADMIN_ROLE = ethers.id("ADMIN_ROLE");
const FREEZER_ROLE = ethers.id("FREEZER_ROLE");

// urutan enum Status di kontrak
const Status = { NONE: 0, ACTIVE: 1, OVERDUE: 2, PAID: 3, DISPUTED: 4, FROZEN: 5 };

async function deployAll() {
  const [admin, creditor, debtor, relayer, freezer, stranger] = await ethers.getSigners();
  const idrx = await ethers.deployContract("MockIDRX", [DECIMALS, admin.address, IDR(10_000_000)]);
  const forwarder = await ethers.deployContract("PiutangForwarder");
  const debtNote = await ethers.deployContract("DebtNote");
  const manager = await ethers.deployContract("DebtManager", [
    debtNote.target,
    idrx.target,
    forwarder.target,
    admin.address,
  ]);
  await debtNote.setManager(manager.target);
  await manager.grantRole(FREEZER_ROLE, freezer.address);

  await idrx.mint(creditor.address, IDR(100_000_000));
  await idrx.mint(debtor.address, IDR(100_000_000));

  const { chainId } = await ethers.provider.getNetwork();
  const domain = E.managerDomain(chainId, manager.target);
  return { admin, creditor, debtor, relayer, freezer, stranger, idrx, forwarder, debtNote, manager, chainId, domain };
}

let counter = 0;
const schedules = new Map(); // noteId → Schedule yang dipakai saat aktivasi

/** Jadwal satu cicilan: seluruh totalOwed jatuh tempo di dueDate. */
const singleInstallment = (note) => ({ dueDates: [note.dueDate], amounts: [note.totalOwed] });

/** Jadwal untuk note (yang didaftarkan buildNote, atau satu cicilan). */
const scheduleOf = (note) => schedules.get(note.noteId) ?? singleInstallment(note);

/**
 * Bangun Note default (pokok Rp1.000.000, total Rp1.100.000, denda 2%/30 hari, satu cicilan jatuh tempo 30 hari).
 * `overrides.schedule` = { dueDates, amounts } untuk cicilan; dueDate & totalOwed diambil dari jadwal itu.
 */
async function buildNote(ctx, overrides = {}) {
  counter++;
  const now = await time.latest();
  const { schedule, ...fields } = overrides;
  const note = {
    noteId: ethers.id(`note-${counter}`),
    version: 1,
    creditor: ctx.creditor.address,
    debtor: ctx.debtor.address,
    docHash: ethers.id(`doc-${counter}`),
    scheduleHash: ethers.ZeroHash,
    principal: IDR(1_000_000),
    totalOwed: IDR(1_100_000),
    lateFeeBps: 200,
    dueDate: now + 30 * DAY,
    disbursement: 0,
    deadline: now + 7 * DAY,
    creditorNonce: BigInt(counter) * 1000n,
    debtorNonce: BigInt(counter) * 1000n,
    ...fields,
  };
  if (schedule) {
    note.dueDate = schedule.dueDates[schedule.dueDates.length - 1];
    note.totalOwed = schedule.amounts.reduce((a, b) => a + b, 0n);
  }
  const sched = schedule ?? singleInstallment(note);
  schedules.set(note.noteId, sched);
  if (!("scheduleHash" in fields)) note.scheduleHash = E.scheduleHash(sched);
  return note;
}

const signNote = (signer, ctx, note) => signer.signTypedData(ctx.domain, E.NOTE_TYPES, note);

async function signPermit(token, owner, spender, value, deadline) {
  const { chainId } = await ethers.provider.getNetwork();
  const nonce = await token.nonces(owner.address);
  const sig = await owner.signTypedData(E.tokenDomain(chainId, token.target), E.PERMIT_TYPES, {
    owner: owner.address,
    spender,
    value,
    nonce,
    deadline,
  });
  return { deadline, ...E.splitSig(sig) };
}

/** Kreditur setor escrow (tanda tangan Note + permit), lalu aktivasi on-chain oleh relayer. */
async function activateOnchain(ctx, note) {
  const sigC = await signNote(ctx.creditor, ctx, note);
  const sigD = await signNote(ctx.debtor, ctx, note);
  const permit = await signPermit(ctx.idrx, ctx.creditor, ctx.manager.target, note.principal, note.deadline);
  await ctx.manager.connect(ctx.relayer).depositEscrow(note, sigC, permit);
  await ctx.manager.connect(ctx.relayer).activateOnchain(note, scheduleOf(note), sigC, sigD);
  return { sigC, sigD };
}

async function signReceipt(ctx, note, overrides = {}) {
  const receipt = {
    noteHash: E.noteStructHash(note),
    proofHash: ethers.id("bukti-transfer-pencairan"),
    amount: note.principal,
    nonce: 777n + BigInt(counter),
    deadline: note.deadline,
    ...overrides,
  };
  const sig = await ctx.debtor.signTypedData(ctx.domain, E.RECEIPT_TYPES, receipt);
  return { receipt, sig };
}

/** Pencairan off-chain: tanda tangan dua pihak + konfirmasi terima dana debitur. */
async function activateOffchain(ctx, note) {
  const sigC = await signNote(ctx.creditor, ctx, note);
  const sigD = await signNote(ctx.debtor, ctx, note);
  const { receipt, sig } = await signReceipt(ctx, note);
  await ctx.manager.connect(ctx.relayer).activateOffchain(note, scheduleOf(note), sigC, sigD, receipt, sig);
  return { sigC, sigD, receipt, sigReceipt: sig };
}

let proofCounter = 0;
async function signPayment(ctx, noteId, amount, overrides = {}) {
  proofCounter++;
  const now = await time.latest();
  const c = {
    noteId,
    amount,
    proofHash: ethers.id(`proof-${proofCounter}`),
    installmentIndex: 1,
    nonce: 5000n + BigInt(proofCounter),
    deadline: now + DAY,
    settleFull: false,
    ...overrides,
  };
  const sig = await ctx.creditor.signTypedData(ctx.domain, E.PAYMENT_TYPES, c);
  return { c, sig };
}

async function payOffchain(ctx, noteId, amount, overrides) {
  const { c, sig } = await signPayment(ctx, noteId, amount, overrides);
  return ctx.manager.connect(ctx.relayer).recordOffchainPayment(c, sig);
}

async function payOnchain(ctx, noteId, amount, installmentIndex = 1) {
  const permit = await signPermit(ctx.idrx, ctx.debtor, ctx.manager.target, amount, (await time.latest()) + DAY);
  return ctx.manager.connect(ctx.debtor).payOnchain(noteId, amount, installmentIndex, permit);
}

module.exports = {
  ethers,
  time,
  E,
  IDR,
  DAY,
  NO_PERMIT,
  ADMIN_ROLE,
  FREEZER_ROLE,
  Status,
  deployAll,
  buildNote,
  scheduleOf,
  signNote,
  signPermit,
  activateOnchain,
  activateOffchain,
  signReceipt,
  signPayment,
  payOffchain,
  payOnchain,
};
