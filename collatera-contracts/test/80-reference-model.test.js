const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const f = require("./fixture");
const { ethers, time, IDR, DAY, NO_PERMIT, Status } = f;

// T7: model referensi denda di JS (BigInt) + test acak dengan seed tetap + invariant.
//
// Model ini SENGAJA dirumuskan berbeda dari kontrak: kontrak menghitung per checkpoint (dengan feeRemainder),
// model ini mengintegralkan "tunggakan × detik" secara terus-menerus (W) lalu membulatkan SEKALI:
//   dendaTotal(t) = floor(W(t) × bps / (10.000 × 30 hari)),  dendaTerutang = dendaTotal − dendaTerbayar.
// Kalau kedua formulasi selalu sama persis, pembulatan lintas checkpoint di kontrak memang tidak bocor.

const DEN = 10_000n * 30n * 86400n;
const SEEDS = Array.from({ length: 24 }, (_, i) => 7001 + i);
const STEPS = 16;

/** PRNG deterministik (mulberry32). */
function prng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    big: (lo, hi) => lo + BigInt(Math.floor(next() * Number(hi - lo + 1n))),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}

class Ref {
  constructor({ dueDates, amounts, bps, t0 }) {
    this.dueDates = dueDates.map(BigInt);
    this.amounts = amounts;
    this.totalOwed = amounts.reduce((a, b) => a + b, 0n);
    this.bps = BigInt(bps);
    this.W = 0n; //            ∫ tunggakan dt (hanya saat berjalan)
    this.last = BigInt(t0);
    this.scheduledPaid = 0n;
    this.feePaid = 0n;
    this.paid = 0n;
    this.status = Status.ACTIVE; // tersimpan (tanpa OVERDUE)
    this.before = null;
    this.fullyPaid = false;
  }
  dueBefore(t) {
    let c = 0n;
    for (let i = 0; i < this.dueDates.length; i++) if (this.dueDates[i] < BigInt(t)) c += this.amounts[i];
    return c;
  }
  arrearsAt(t) {
    const d = this.dueBefore(t);
    return this.fullyPaid ? 0n : d > this.scheduledPaid ? d - this.scheduledPaid : 0n;
  }
  /** majukan integral sampai t; denda berjalan saat ACTIVE atau DISPUTED, berhenti saat FROZEN. */
  advance(t) {
    t = BigInt(t);
    if (t <= this.last) return;
    const running = (this.status === Status.ACTIVE || this.status === Status.DISPUTED) && !this.fullyPaid && this.bps !== 0n;
    if (running) {
      let a = this.last;
      const cuts = this.dueDates.filter((d) => d > a && d < t).concat([t]);
      for (const b of cuts) {
        // dalam (a, b] tunggakan = cicilan dengan dueDate <= a dikurangi yang sudah dibayar
        let c = 0n;
        for (let i = 0; i < this.dueDates.length; i++) if (this.dueDates[i] <= a) c += this.amounts[i];
        const arr = c > this.scheduledPaid ? c - this.scheduledPaid : 0n;
        this.W += arr * (b - a);
        a = b;
      }
    }
    this.last = t;
  }
  feeOwed() {
    return this.fullyPaid ? 0n : (this.W * this.bps) / DEN - this.feePaid;
  }
  remaining() {
    return this.fullyPaid ? 0n : this.totalOwed - this.scheduledPaid + this.feeOwed();
  }
  viewStatus(t) {
    if (this.status === Status.ACTIVE && !this.fullyPaid && (this.arrearsAt(t) > 0n || this.feeOwed() > 0n)) return Status.OVERDUE;
    return this.status;
  }
  /** pembayaran pada waktu t; amount sudah dipotong ke sisa utang oleh pemanggil. */
  pay(amount, t) {
    this.advance(t);
    const arrears = this.arrearsAt(t);
    const owed = this.feeOwed();
    let toSched = amount < arrears ? amount : arrears;
    const rest = amount - toSched;
    const toFee = rest < owed ? rest : owed;
    toSched += rest - toFee;
    this.scheduledPaid += toSched;
    this.feePaid += toFee;
    this.paid += amount;
    if (this.totalOwed - this.scheduledPaid + this.feeOwed() === 0n) {
      this.fullyPaid = true;
      if (this.status === Status.ACTIVE) this.status = Status.PAID;
    }
  }
}

async function scenario(seed) {
  const rng = prng(seed);
  const ctx = await loadFixture(f.deployAll);
  const { manager, idrx, creditor, debtor, relayer, admin, debtNote } = ctx;

  // jadwal acak 1-4 cicilan
  const n = rng.int(1, 4);
  const now = await time.latest();
  const dueDates = [];
  let d = now + rng.int(3, 15) * DAY;
  const amounts = [];
  for (let i = 0; i < n; i++) {
    dueDates.push(d);
    amounts.push(IDR(rng.int(100_000, 600_000)) + rng.big(0n, 99n));
    d += rng.int(2, 20) * DAY + rng.int(0, 3600);
  }
  const bps = rng.pick([0, 200, 200, 200]);
  const principal = IDR(50_000);
  const note = await f.buildNote(ctx, { schedule: { dueDates, amounts }, principal, lateFeeBps: bps });

  // escrow lain yang tidak pernah diaktifkan: saldo manager harus persis sebesar ini
  const pending = await f.buildNote(ctx, { principal: IDR(10_000) + BigInt(seed), totalOwed: IDR(20_000) + BigInt(seed) });
  const sigP = await f.signNote(creditor, ctx, pending);
  await manager.depositEscrow(pending, sigP, await f.signPermit(idrx, creditor, manager.target, pending.principal, pending.deadline));

  const credBefore = await idrx.balanceOf(creditor.address);
  const debBefore = await idrx.balanceOf(debtor.address);
  await f.activateOnchain(ctx, note);
  const t0 = await time.latest();
  const ref = new Ref({ dueDates, amounts, bps, t0 });
  let onchainPaid = 0n;
  const label = (i, a) => `seed ${seed} langkah ${i} [${a}]`;

  async function check(i, a, prevFee, feeMayDrop) {
    const t = await time.latest();
    ref.advance(t);
    const L = label(i, a);
    expect(await manager.lateFeeOf(note.noteId), L + " lateFeeOf").to.equal(ref.feeOwed());
    expect(await manager.remaining(note.noteId), L + " remaining").to.equal(ref.remaining());
    expect(await manager.overdueAmount(note.noteId), L + " overdueAmount").to.equal(ref.arrearsAt(t));
    expect(await manager.statusOf(note.noteId), L + " status").to.equal(ref.viewStatus(t));
    // denda tidak turun kecuali dibayar
    if (!feeMayDrop && prevFee !== null) expect(ref.feeOwed(), L + " denda turun tanpa pembayaran").to.be.gte(prevFee);

    // invariant dana
    expect(await idrx.balanceOf(manager.target), L + " saldo manager = escrow belum aktif").to.equal(pending.principal);
    expect((await idrx.balanceOf(debtor.address)) - debBefore, L + " debitur").to.equal(principal - onchainPaid);
    expect((await idrx.balanceOf(creditor.address)) - credBefore, L + " kreditur").to.equal(-principal + onchainPaid);
    // PAID <=> token ter-burn
    if (ref.status === Status.PAID) await expect(debtNote.ownerOf(BigInt(note.noteId)), L + " burn").to.be.reverted;
    else expect(await debtNote.ownerOf(BigInt(note.noteId)), L + " token").to.equal(creditor.address);
    return ref.feeOwed();
  }

  let fee = await check(0, "aktivasi", null, true);
  const lastDue = Number(dueDates[dueDates.length - 1]);
  for (let i = 1; i <= STEPS && ref.status !== Status.PAID; i++) {
    const t = (await time.latest()) + rng.int(1, 12 * DAY);
    // pastikan sebagian skenario melewati jatuh tempo terakhir
    const ts = i === 6 && t < lastDue ? lastDue + rng.int(1, 5 * DAY) : t;
    const act = rng.pick(["wait", "wait", "onchain", "onchain", "offchain", "dispute", "close", "freeze", "unfreeze"]);
    let applied = act;
    let feeMayDrop = false;
    const st = ref.status;
    ref.advance(ts); // posisi model pada waktu eksekusi (tx berikut dikirim tepat di ts)
    if (act === "onchain" && (st === Status.ACTIVE || st === Status.DISPUTED) && !ref.fullyPaid) {
      const left = ref.remaining();
      const want = rng.pick([1n, left / 3n + 1n, left / 2n + 1n, left, left + rng.big(1n, IDR(1000))]);
      const amount = want > left ? left : want;
      const permit = await f.signPermit(idrx, debtor, manager.target, want, ts + DAY);
      await time.setNextBlockTimestamp(ts);
      await manager.connect(debtor).payOnchain(note.noteId, want, 1, permit);
      ref.pay(amount, ts);
      onchainPaid += amount;
      feeMayDrop = true;
    } else if (act === "offchain" && st === Status.ACTIVE && !ref.fullyPaid) {
      const left = ref.remaining();
      const amount = rng.pick([1n, left / 2n + 1n, left]);
      const { c, sig } = await f.signPayment(ctx, note.noteId, amount, { deadline: ts + DAY });
      await time.setNextBlockTimestamp(ts);
      await manager.connect(relayer).recordOffchainPayment(c, sig);
      ref.pay(amount, ts);
      feeMayDrop = true;
    } else if (act === "dispute" && st === Status.ACTIVE) {
      await time.setNextBlockTimestamp(ts);
      await manager.connect(rng.pick([creditor, debtor])).openDispute(note.noteId, ethers.id("a"));
      ref.status = Status.DISPUTED;
    } else if (act === "close" && st === Status.DISPUTED) {
      await time.setNextBlockTimestamp(ts);
      await manager.connect(admin).closeDispute(note.noteId, ethers.id("r"), false);
      ref.status = ref.fullyPaid ? Status.PAID : Status.ACTIVE;
    } else if (act === "freeze" && (st === Status.ACTIVE || st === Status.DISPUTED)) {
      await time.setNextBlockTimestamp(ts);
      await manager.connect(admin).freeze(note.noteId, ethers.id("f"));
      ref.before = st;
      ref.status = Status.FROZEN;
    } else if (act === "unfreeze" && st === Status.FROZEN) {
      await time.setNextBlockTimestamp(ts);
      await manager.connect(admin).unfreeze(note.noteId, ethers.id("u"));
      ref.status = ref.before === Status.ACTIVE && ref.fullyPaid ? Status.PAID : ref.before;
    } else {
      applied = "wait";
      await time.setNextBlockTimestamp(ts);
      await manager.accrue(note.noteId); // checkpoint publik: tidak boleh mengubah angka apa pun
    }
    fee = await check(i, applied, fee, feeMayDrop);
  }

  // akhir: refund escrow yang tidak pernah aktif → saldo manager nol
  await manager.connect(creditor).refundEscrow(pending);
  expect(await idrx.balanceOf(manager.target)).to.equal(0n);
}

describe("T7: model referensi denda (BigInt, seed tetap) vs kontrak + invariant", () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: lateFeeOf/remaining/overdueAmount/status = model; saldo, burn, denda monoton`, async () => {
      await scenario(seed);
    });
  }
});
