const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const f = require("./fixture");
const { ethers, time, IDR, DAY, Status } = f;

// Regresi hasil review (branch fix/review-hardening). Satu blok describe per tugas.

describe("T1: view konsisten setelah markPaid", () => {
  it("markPaid saat OVERDUE: remaining, overdueAmount, lateFeeOf, getNote semuanya konsisten dengan PAID", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, creditor } = ctx;
    const note = await f.buildNote(ctx);
    await f.activateOnchain(ctx, note);
    await time.increaseTo(Number(note.dueDate) + 20 * DAY);
    expect(await manager.statusOf(note.noteId)).to.equal(Status.OVERDUE);
    const feeBefore = await manager.lateFeeOf(note.noteId);
    expect(feeBefore).to.be.gt(0n);

    const tx = await manager.connect(creditor).markPaid(note.noteId);
    // event waived tetap berisi seluruh sisa (tunggakan + denda) saat ditandai lunas
    const waived = (await manager.queryFilter(manager.filters.NoteMarkedPaid(note.noteId)))[0].args.waived;
    expect(waived).to.be.gte(note.totalOwed + feeBefore);
    await expect(tx).to.emit(manager, "NoteMarkedPaid");

    expect(await manager.statusOf(note.noteId)).to.equal(Status.PAID);
    expect(await manager.remaining(note.noteId)).to.equal(0n);
    expect(await manager.overdueAmount(note.noteId)).to.equal(0n);
    expect(await manager.lateFeeOf(note.noteId)).to.equal(0n);
    const v = await manager.getNote(note.noteId);
    expect(v.lateFeeAccrued).to.equal(0n);
    expect(v.fullyPaid).to.equal(true);
    expect(v.status).to.equal(Status.PAID);

    // tetap 0 setelah waktu berjalan
    await time.increase(60 * DAY);
    expect(await manager.overdueAmount(note.noteId)).to.equal(0n);
    expect(await manager.lateFeeOf(note.noteId)).to.equal(0n);
  });
});

describe("T2: pelunasan off-chain dengan settleFull", () => {
  /** Note OVERDUE (denda berjalan). Kreditur menandatangani nominal = remaining() saat ini, eksekusi `delay` detik kemudian. */
  async function overdueNote(ctx) {
    const note = await f.buildNote(ctx, { disbursement: 1 });
    await f.activateOffchain(ctx, note);
    await time.increaseTo(Number(note.dueDate) + 10 * DAY);
    return note;
  }
  async function execAfter(ctx, note, sec, overrides = {}, amountFn = (rem) => rem) {
    const rem = await ctx.manager.remaining(note.noteId);
    const amount = amountFn(rem);
    const { c, sig } = await f.signPayment(ctx, note.noteId, amount, { deadline: (await time.latest()) + 30 * DAY, ...overrides });
    await time.setNextBlockTimestamp((await time.latest()) + sec);
    return { c, sig, tx: ctx.manager.connect(ctx.relayer).recordOffchainPayment(c, sig) };
  }

  it("kasus review: konfirmasi = remaining() lalu dieksekusi 100 detik kemudian; settleFull=false tetap menyisakan denda kecil", async () => {
    const ctx = await loadFixture(f.deployAll);
    const note = await overdueNote(ctx);
    const { tx } = await execAfter(ctx, note, 100, { settleFull: false });
    await tx;
    const left = await ctx.manager.remaining(note.noteId);
    expect(left).to.be.gt(0n);
    expect(left).to.be.lt(IDR(1)); // sisa hanya denda ~100 detik
    expect(await ctx.manager.statusOf(note.noteId)).to.equal(Status.OVERDUE);
  });

  it("settleFull=true: sisa denda kecil dihapus, event menunjukkan jumlahnya, PAID + burn", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, debtNote } = ctx;
    const note = await overdueNote(ctx);
    const { c, tx } = await execAfter(ctx, note, 100, { settleFull: true });
    const rcpt = await (await tx).wait();
    const ev = rcpt.logs.map((l) => { try { return manager.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "LateFeeWaived");
    expect(ev, "event LateFeeWaived").to.not.equal(undefined);
    expect(ev.args.noteId).to.equal(note.noteId);
    expect(ev.args.amount).to.be.gt(0n);
    expect(ev.args.amount).to.be.lt(IDR(1));
    expect(await manager.statusOf(note.noteId)).to.equal(Status.PAID);
    expect(await manager.remaining(note.noteId)).to.equal(0n);
    expect(await manager.lateFeeOf(note.noteId)).to.equal(0n);
    const v = await manager.getNote(note.noteId);
    expect(v.scheduledPaid).to.equal(note.totalOwed); // seluruh cicilan terbayar penuh, hanya denda yang dikurangi
    expect(v.paid).to.equal(c.amount);
    await expect(debtNote.ownerOf(BigInt(note.noteId))).to.be.reverted; // token ter-burn
  });

  it("settleFull=true tidak melonggarkan Overpayment (nominal di atas sisa tetap ditolak)", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager } = ctx;
    const note = await overdueNote(ctx);
    const rem = await manager.remaining(note.noteId);
    const { c, sig } = await f.signPayment(ctx, note.noteId, rem + 1_000n, { settleFull: true, deadline: (await time.latest()) + DAY });
    // eksekusi tepat 1 detik setelah blok terakhir: bayar sedikit lebih dari sisa saat itu → tetap Overpayment pada off-chain
    await expect(manager.connect(ctx.relayer).recordOffchainPayment(c, sig)).to.be.revertedWithCustomError(manager, "Overpayment");
  });

  it("settleFull=true ditolak bila selisih melebihi toleransi (denda > 1 hari) atau nominal tidak menutup seluruh cicilan", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager } = ctx;
    const note = await overdueNote(ctx);
    // 3 hari kemudian: denda yang tertinggal ≈ 3 hari > toleransi 1 hari
    const late = await execAfter(ctx, note, 3 * DAY, { settleFull: true });
    await expect(late.tx).to.be.revertedWithCustomError(manager, "SettleToleranceExceeded");
    expect(await manager.statusOf(note.noteId)).to.equal(Status.OVERDUE);

    // nominal kurang dari seluruh sisa cicilan: ditolak walau selisihnya kecil dibanding toleransi
    const short = await f.signPayment(ctx, note.noteId, note.totalOwed - 1n, { settleFull: true, deadline: (await time.latest()) + DAY });
    await expect(manager.connect(ctx.relayer).recordOffchainPayment(short.c, short.sig)).to.be.revertedWithCustomError(
      manager,
      "SettleToleranceExceeded"
    );
  });

  it("settleFull ikut ditandatangani: membalik flag setelah ditandatangani membuat signature tidak valid", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager } = ctx;
    const note = await overdueNote(ctx);
    const { c, sig } = await f.signPayment(ctx, note.noteId, IDR(1_000), { settleFull: false });
    await expect(
      manager.connect(ctx.relayer).recordOffchainPayment({ ...c, settleFull: true }, sig)
    ).to.be.revertedWithCustomError(manager, "InvalidSignature");
  });
});
