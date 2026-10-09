const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const f = require("./fixture");
const { ethers, time, E, IDR, DAY, Status } = f;

const REASON = ethers.id("alasan");

/** Denda yang diharapkan: Σ tunggakan × detik × 2% / 30 hari (dibulatkan ke bawah sekali). */
const expectedFee = (segments) => (segments.reduce((acc, [base, secs]) => acc + base * BigInt(secs), 0n) * 200n) / (10_000n * BigInt(30 * DAY));

/** Tiga cicilan Rp400.000 (total Rp1.200.000), jatuh tempo +10, +40, +70 hari. */
async function threeInstallments(ctx, over = {}) {
  const now = await time.latest();
  const schedule = {
    dueDates: [now + 10 * DAY, now + 40 * DAY, now + 70 * DAY],
    amounts: [IDR(400_000), IDR(400_000), IDR(400_000)],
  };
  const note = await f.buildNote(ctx, { schedule, ...over });
  await f.activateOnchain(ctx, note);
  return { note, schedule, d: schedule.dueDates };
}

/** Bayar tepat di `timestamp` (approve lebih dulu: permit akan kedaluwarsa karena waktu dilompati). */
async function payAt(ctx, noteId, amount, timestamp) {
  await ctx.idrx.connect(ctx.debtor).approve(ctx.manager.target, amount);
  await time.setNextBlockTimestamp(timestamp);
  return ctx.manager.connect(ctx.debtor).payOnchain(noteId, amount, 1, f.NO_PERMIT);
}

describe("Jadwal cicilan on-chain dan OVERDUE per cicilan", () => {
  it("jadwal tersimpan dan bisa dibaca; OVERDUE sejak cicilan pertama lewat, bukan jatuh tempo akhir", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager } = ctx;
    const { note, schedule, d } = await threeInstallments(ctx);

    const [dueDates, amounts] = await manager.getSchedule(note.noteId);
    expect(dueDates.map(Number)).to.deep.equal(schedule.dueDates);
    expect(amounts).to.deep.equal(schedule.amounts);
    expect((await manager.getNote(note.noteId)).dueDate).to.equal(d[2]);

    await time.increaseTo(d[0]);
    expect(await manager.statusOf(note.noteId)).to.equal(Status.ACTIVE);
    await time.increaseTo(d[0] + 1);
    expect(await manager.statusOf(note.noteId)).to.equal(Status.OVERDUE);
    expect(await manager.overdueAmount(note.noteId)).to.equal(IDR(400_000));
  });

  it("cicilan Rp400.000 terlambat 15 hari → denda Rp4.000; bayar tunggakan + denda → kembali ACTIVE", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager } = ctx;
    const { note, d } = await threeInstallments(ctx);

    await ctx.idrx.connect(ctx.debtor).approve(manager.target, IDR(404_000));
    await time.increaseTo(d[0] + 15 * DAY);
    expect(await manager.lateFeeOf(note.noteId)).to.equal(IDR(4_000));
    expect(await manager.remaining(note.noteId)).to.equal(IDR(1_204_000));

    await time.setNextBlockTimestamp(d[0] + 15 * DAY + 1);
    await expect(manager.connect(ctx.debtor).payOnchain(note.noteId, IDR(404_000), 1, f.NO_PERMIT))
      .to.emit(manager, "LateFeeAccrued")
      .and.to.emit(manager, "PaymentRecorded");
    // denda 1 detik terakhir < 1 sen → sisa denda 0
    expect(await manager.lateFeeOf(note.noteId)).to.equal(0n);
    expect(await manager.overdueAmount(note.noteId)).to.equal(0n);
    expect(await manager.statusOf(note.noteId)).to.equal(Status.ACTIVE);
    expect(await manager.remaining(note.noteId)).to.equal(IDR(800_000));
  });

  it("alokasi: tunggakan dulu, lalu denda, sisanya ke cicilan berikutnya", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager } = ctx;
    const { note, d } = await threeInstallments(ctx);

    // bayar sebagian tunggakan saja: denda tidak tersentuh, tetap OVERDUE
    await payAt(ctx, note.noteId, IDR(100_000), d[0] + 15 * DAY);
    let v = await manager.getNote(note.noteId);
    expect(v.scheduledPaid).to.equal(IDR(100_000));
    expect(v.lateFeeAccrued).to.equal(IDR(4_000));
    expect(await manager.statusOf(note.noteId)).to.equal(Status.OVERDUE);

    // 15 hari lagi: denda berjalan dari sisa tunggakan Rp300.000 → +Rp3.000
    const t = d[0] + 30 * DAY;
    await expect(payAt(ctx, note.noteId, IDR(500_000), t))
      .to.emit(manager, "PaymentRecorded")
      .withArgs(note.noteId, IDR(500_000), IDR(600_000), anyValue, true, 1, ethers.ZeroHash, IDR(7_000));
    v = await manager.getNote(note.noteId);
    // Rp300.000 tunggakan + Rp7.000 denda + Rp193.000 ke cicilan ke-2
    expect(v.scheduledPaid).to.equal(IDR(593_000));
    expect(v.lateFeeAccrued).to.equal(0n);
    expect(v.paid).to.equal(IDR(600_000));
    expect(await manager.statusOf(note.noteId)).to.equal(Status.ACTIVE);
    expect(await manager.remaining(note.noteId)).to.equal(IDR(607_000));
  });

  it("denda dihitung per segmen jatuh tempo dan hasilnya sama walau checkpoint dipanggil tiap hari", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager } = ctx;
    const a = await threeInstallments(ctx);
    const b = await threeInstallments(ctx);

    // a: tidak ada yang memanggil accrue. b: checkpoint setiap hari selama 40 hari.
    for (let day = 1; day <= 40; day++) {
      await time.increaseTo(b.d[0] + day * DAY);
      await manager.accrue(b.note.noteId);
    }
    await time.increase(1);
    const tA = await time.latest();
    const feeA = await manager.lateFeeOf(a.note.noteId);
    const want = expectedFee([
      [IDR(400_000), a.d[1] - a.d[0]], // hanya cicilan 1 terlambat
      [IDR(800_000), tA - a.d[1]], //    cicilan 1 + 2 terlambat
    ]);
    expect(feeA).to.equal(want);
    const feeB = await manager.lateFeeOf(b.note.noteId);
    // selisih hanya pembulatan per checkpoint (maks 1 satuan per pemanggilan)
    expect(feeA - feeB).to.be.lte(41n);
    expect(feeA).to.be.gte(feeB);
  });

  it("denda TETAP berjalan selama DISPUTED (BR-21a baru), berhenti hanya saat FROZEN", async () => {
    // Aturan lama: denda berhenti saat DISPUTED. Diubah karena debitur bisa membuka dispute saat OVERDUE
    // dan menghentikan denda tanpa batas (hanya admin yang bisa menutup). Kini denda jalan terus;
    // admin bisa menghapus porsi periode dispute lewat closeDispute(..., waiveFee=true). FROZEN tidak berubah.
    const ctx = await loadFixture(f.deployAll);
    const { manager, creditor, admin } = ctx;
    const { note, d } = await threeInstallments(ctx);

    await time.setNextBlockTimestamp(d[0] + 15 * DAY);
    await manager.connect(creditor).openDispute(note.noteId, REASON);
    expect(await manager.lateFeeOf(note.noteId)).to.equal(IDR(4_000));
    await time.increase(20 * DAY);
    expect(await manager.lateFeeOf(note.noteId)).to.be.gt(IDR(4_000) + IDR(5_000));
    await manager.connect(admin).closeDispute(note.noteId, REASON, true); // waive: kembali ke denda sebelum dispute
    expect(await manager.statusOf(note.noteId)).to.equal(Status.OVERDUE);
    const afterDispute = await manager.lateFeeOf(note.noteId);
    expect(afterDispute).to.equal(IDR(4_000));

    await manager.connect(admin).freeze(note.noteId, REASON);
    await time.increase(20 * DAY);
    expect(await manager.lateFeeOf(note.noteId)).to.be.lte(afterDispute + IDR(1));
    await manager.connect(admin).unfreeze(note.noteId, REASON);
    const resumed = await manager.lateFeeOf(note.noteId);
    await time.increase(15 * DAY);
    expect(await manager.lateFeeOf(note.noteId)).to.be.greaterThan(resumed + IDR(3_000));
  });

  it("tanpa denda (lateFeeBps = 0): OVERDUE tetap terdeteksi tapi sisa utang tidak bertambah", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager } = ctx;
    const { note, d } = await threeInstallments(ctx, { lateFeeBps: 0 });
    await time.increaseTo(d[2] + 100 * DAY);
    expect(await manager.statusOf(note.noteId)).to.equal(Status.OVERDUE);
    expect(await manager.lateFeeOf(note.noteId)).to.equal(0n);
    expect(await manager.remaining(note.noteId)).to.equal(IDR(1_200_000));
  });

  it("revisi: denda yang sudah berjalan tetap terutang; OVERDUE sampai denda dibayar", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, relayer } = ctx;
    const note = await f.buildNote(ctx);
    await f.activateOnchain(ctx, note);
    await time.increaseTo(note.dueDate + 15 * DAY);

    const now = await time.latest();
    const schedule = { dueDates: [now + 30 * DAY], amounts: [note.totalOwed] };
    const a = {
      noteId: note.noteId,
      newVersion: 2,
      newDocHash: ethers.id("doc-revisi-denda"),
      newScheduleHash: E.scheduleHash(schedule),
      newTotalOwed: note.totalOwed,
      newLateFeeBps: 200,
      newDueDate: schedule.dueDates[0],
      deadline: now + DAY,
      creditorNonce: 77_001n,
      debtorNonce: 77_002n,
    };
    const sigC = await ctx.creditor.signTypedData(ctx.domain, E.AMENDMENT_TYPES, a);
    const sigD = await ctx.debtor.signTypedData(ctx.domain, E.AMENDMENT_TYPES, a);
    await manager.connect(relayer).amend(a, schedule, sigC, sigD);

    expect(await manager.overdueAmount(note.noteId)).to.equal(0n);
    const fee = await manager.lateFeeOf(note.noteId);
    expect(fee).to.be.gte(IDR(11_000)); // Rp1.100.000 × 2% × 15/30
    expect(await manager.statusOf(note.noteId)).to.equal(Status.OVERDUE);
    await f.payOnchain(ctx, note.noteId, fee);
    expect(await manager.statusOf(note.noteId)).to.equal(Status.ACTIVE);
    expect(await manager.remaining(note.noteId)).to.equal(note.totalOwed);
  });
});

describe("Validasi jadwal dan tarif denda", () => {
  async function expectActivationError(ctx, note, error) {
    await expect(f.activateOnchain(ctx, note)).to.be.revertedWithCustomError(ctx.manager, error);
  }

  it("tarif denda hanya 0 atau 200 bps", async () => {
    const ctx = await loadFixture(f.deployAll);
    await expectActivationError(ctx, await f.buildNote(ctx, { lateFeeBps: 100 }), "InvalidLateFee");
    await expectActivationError(ctx, await f.buildNote(ctx, { lateFeeBps: 201 }), "InvalidLateFee");
  });

  it("jadwal harus cocok dengan scheduleHash yang ditandatangani", async () => {
    const ctx = await loadFixture(f.deployAll);
    const note = await f.buildNote(ctx, { scheduleHash: ethers.id("hash-lain") });
    await expectActivationError(ctx, note, "ScheduleMismatch");
  });

  it("menolak jadwal tidak valid: jumlah ≠ total, akhir ≠ dueDate, tidak urut, nominal 0, sudah lewat, > 24, panjang beda", async () => {
    const ctx = await loadFixture(f.deployAll);
    const now = await time.latest();
    const t = (days) => now + days * DAY;

    const base = await f.buildNote(ctx, { schedule: { dueDates: [t(10), t(20)], amounts: [IDR(600_000), IDR(500_000)] } });
    await expectActivationError(ctx, { ...base, totalOwed: base.totalOwed + 1n }, "InvalidSchedule");
    await expectActivationError(ctx, { ...base, dueDate: base.dueDate + 1 }, "InvalidSchedule");

    const bad = [
      { dueDates: [t(20), t(10)], amounts: [IDR(600_000), IDR(500_000)] },
      { dueDates: [t(10), t(10)], amounts: [IDR(600_000), IDR(500_000)] },
      { dueDates: [t(10), t(20)], amounts: [0n, IDR(1_100_000)] },
      { dueDates: [now - DAY, t(20)], amounts: [IDR(600_000), IDR(500_000)] },
      { dueDates: Array.from({ length: 25 }, (_, i) => t(i + 1)), amounts: Array(25).fill(IDR(44_000)) },
    ];
    for (const schedule of bad) {
      await expectActivationError(ctx, await f.buildNote(ctx, { schedule }), "InvalidSchedule");
    }

    const mismatch = await f.buildNote(ctx, { schedule: { dueDates: [t(10), t(20)], amounts: [IDR(1_100_000)] } });
    await expectActivationError(ctx, { ...mismatch, totalOwed: IDR(1_100_000) }, "InvalidSchedule");
  });

  it("24 cicilan masih diterima", async () => {
    const ctx = await loadFixture(f.deployAll);
    const now = await time.latest();
    const schedule = { dueDates: Array.from({ length: 24 }, (_, i) => now + (i + 1) * 30 * DAY), amounts: Array(24).fill(IDR(50_000)) };
    const note = await f.buildNote(ctx, { schedule });
    await f.activateOnchain(ctx, note);
    await time.increaseTo(schedule.dueDates[23] + 30 * DAY);
    expect(await ctx.manager.statusOf(note.noteId)).to.equal(Status.OVERDUE);
    await f.payOnchain(ctx, note.noteId, (await ctx.manager.remaining(note.noteId)) + IDR(1));
    expect(await ctx.manager.statusOf(note.noteId)).to.equal(Status.PAID);
  });
});

describe("PiutangForwarder: gas dari relayer", () => {
  it("relayer yang memberi gas kurang dari req.gas membuat seluruh transaksi gagal (nonce tidak terpakai)", async () => {
    const ctx = await loadFixture(f.deployAll);
    const target = await ethers.deployContract("MockGasBurner");
    // forwarder hanya boleh ke manager (T5): pakai forwarder khusus yang manager-nya adalah mock ini
    const fwd = await ethers.deployContract("PiutangForwarder");
    await fwd.setManager(target.target);
    const r = {
      from: ctx.debtor.address,
      to: target.target,
      gas: 1_000_000n,
      nonce: await fwd.nonces(ctx.debtor.address),
      deadline: (await time.latest()) + DAY,
      data: target.interface.encodeFunctionData("run"),
    };
    const sig = await ctx.debtor.signTypedData(E.forwarderDomain(ctx.chainId, fwd.target), E.FORWARD_TYPES, r);

    // Gas kurang: inner call di target kehabisan gas dan ditelan try/catch. Tanpa pengecekan, ini "sukses"
    // dengan innerOk=false dan nonce pengguna terpakai.
    await expect(fwd.connect(ctx.relayer).execute(r, sig, { gasLimit: 250_000 })).to.be.reverted;
    expect(await fwd.nonces(ctx.debtor.address)).to.equal(0n);

    await expect(fwd.connect(ctx.relayer).execute(r, sig, { gasLimit: 1_200_000 }))
      .to.emit(target, "Done")
      .withArgs(false); // inner call memang dibatasi 200k oleh target sendiri, bukan oleh relayer
    expect(await fwd.nonces(ctx.debtor.address)).to.equal(1n);
  });
});
