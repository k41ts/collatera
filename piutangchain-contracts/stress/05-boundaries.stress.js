// BATAS EKSTREM 5: detik tepat, nominal terkecil/terbesar, durasi sangat panjang, serangan debu, gas, dan pause.
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers, time, expect, E, S, IDR, DAY, NO_PERMIT, deployStress, openNote, signPayment, expectMatches, nextId, nextNonce, prng } = require("./lib/setup");
const { DENOM } = require("./lib/model");

const REASON = ethers.id("batas");
const YEAR = 365 * DAY;
const MAX_AMOUNT = 2n ** 128n - 1n;
const fixture = () => deployStress(4);

/** Kirim tx tepat pada `ts` lalu kembalikan receipt. */
async function at(ts, txFn) {
  await time.setNextBlockTimestamp(ts);
  return (await txFn()).wait();
}

describe("STRESS 5 · batas ekstrem: waktu, nominal, durasi, debu, gas, pause", function () {
  this.timeout(0);

  it("setiap cicilan baru terlambat tepat 1 detik SETELAH jatuh tempo (bukan di detiknya)", async () => {
    const ctx = await loadFixture(fixture);
    const [creditor, , debtor] = ctx.parties;
    const now = await time.latest();
    const dueDates = [1, 2, 3, 5, 8].map((k) => now + k * 7 * DAY);
    const amounts = [IDR(100), IDR(200), IDR(300), IDR(400), IDR(500)];
    const { model } = await openNote(ctx, { creditor, debtor, schedule: { dueDates, amounts } });
    let cum = 0n;
    for (let i = 0; i < dueDates.length; i++) {
      await time.increaseTo(dueDates[i]);
      expect(await ctx.manager.overdueAmount(model.noteId), `tepat di jatuh tempo #${i}`).to.equal(cum);
      await expectMatches(ctx, model, `detik jatuh tempo #${i}`);
      await time.increaseTo(dueDates[i] + 1);
      cum += amounts[i];
      expect(await ctx.manager.overdueAmount(model.noteId), `1 detik setelah jatuh tempo #${i}`).to.equal(cum);
      expect(await ctx.manager.statusOf(model.noteId)).to.equal(S.OVERDUE);
      await expectMatches(ctx, model, `detik+1 jatuh tempo #${i}`);
    }
  });

  it("bayar tepat di detik jatuh tempo: tanpa denda; satu detik kemudian: denda mulai berjalan (sisa pembagian dibawa)", async () => {
    const ctx = await loadFixture(fixture);
    const [creditor, , debtor] = ctx.parties;
    const now = await time.latest();
    const a = await openNote(ctx, { creditor, debtor, schedule: { dueDates: [now + 10 * DAY, now + 20 * DAY], amounts: [IDR(1_000), IDR(1_000)] } });
    await at(a.model.dueDates[0], () => ctx.manager.connect(debtor).payOnchain(a.model.noteId, IDR(1_000), 0, NO_PERMIT));
    a.model.pay(IDR(1_000), true, a.model.dueDates[0]);
    expect(await ctx.manager.lateFeeOf(a.model.noteId)).to.equal(0n);
    await expectMatches(ctx, a.model, "bayar tepat waktu");

    const now2 = await time.latest();
    const b = await openNote(ctx, { creditor, debtor, schedule: { dueDates: [now2 + 10 * DAY, now2 + 20 * DAY], amounts: [IDR(1_000), IDR(1_000)] } });
    await time.increaseTo(b.model.dueDates[0] + 1n);
    // 1 detik terlambat atas Rp1.000: 100.000 × 200 × 1 / 25.920.000.000 → 0 satuan, sisa pembagian dibawa
    expect(await ctx.manager.lateFeeOf(b.model.noteId)).to.equal(0n);
    expect(await ctx.manager.statusOf(b.model.noteId)).to.equal(S.OVERDUE);
    await expectMatches(ctx, b.model, "terlambat 1 detik");
  });

  it("deadline signature tepat di detik eksekusi diterima, satu detik setelahnya ditolak (Note, receipt, konfirmasi, revisi, forwarder)", async () => {
    const ctx = await loadFixture(fixture);
    const { manager, relayer, forwarder } = ctx;
    const [creditor, , debtor] = ctx.parties;
    const now = await time.latest();
    const mkNote = async (deadline, disbursement = 0) => {
      const schedule = { dueDates: [now + 30 * DAY], amounts: [IDR(1_000)] };
      const note = {
        noteId: nextId("dl"),
        version: 1,
        creditor: creditor.address,
        debtor: debtor.address,
        docHash: nextId("dl-doc"),
        scheduleHash: E.scheduleHash(schedule),
        principal: IDR(900),
        totalOwed: IDR(1_000),
        lateFeeBps: 200,
        dueDate: schedule.dueDates[0],
        disbursement,
        deadline,
        creditorNonce: nextNonce(),
        debtorNonce: nextNonce(),
      };
      return { note, schedule, sigC: await creditor.signTypedData(ctx.domain, E.NOTE_TYPES, note), sigD: await debtor.signTypedData(ctx.domain, E.NOTE_TYPES, note) };
    };

    // Note: deadline == timestamp blok → sah
    const t1 = now + 100;
    const ok = await mkNote(t1);
    await at(t1, () => manager.connect(relayer).depositEscrow(ok.note, ok.sigC, NO_PERMIT));
    // deadline == timestamp − 1 → kedaluwarsa
    const late = await mkNote(t1 + 50);
    await time.setNextBlockTimestamp(t1 + 51);
    await expect(manager.connect(relayer).depositEscrow(late.note, late.sigC, NO_PERMIT)).to.be.revertedWithCustomError(manager, "SignatureExpired");

    // Receipt off-chain dengan deadline tepat
    const t2 = t1 + 100;
    const off = await mkNote(t2 + 1000, 1);
    const receipt = { noteHash: E.noteStructHash(off.note), proofHash: nextId("r"), amount: off.note.principal, nonce: nextNonce(), deadline: t2 };
    const sigR = await debtor.signTypedData(ctx.domain, E.RECEIPT_TYPES, receipt);
    await at(t2, () => manager.connect(relayer).activateOffchain(off.note, off.schedule, off.sigC, off.sigD, receipt, sigR));

    // Konfirmasi pembayaran
    const t3 = t2 + 100;
    const pay = await signPayment(ctx, creditor, off.note.noteId, IDR(1), t3);
    await at(t3, () => manager.connect(relayer).recordOffchainPayment(pay.c, pay.sig));
    const pay2 = await signPayment(ctx, creditor, off.note.noteId, IDR(1), t3 + 10);
    await time.setNextBlockTimestamp(t3 + 11);
    await expect(manager.connect(relayer).recordOffchainPayment(pay2.c, pay2.sig)).to.be.revertedWithCustomError(manager, "SignatureExpired");

    // Revisi
    const t4 = t3 + 100;
    const schedule = { dueDates: [now + 40 * DAY], amounts: [IDR(1_000)] };
    const amend = {
      noteId: off.note.noteId,
      newVersion: 2,
      newDocHash: nextId("dl-rev"),
      newScheduleHash: E.scheduleHash(schedule),
      newTotalOwed: IDR(1_000),
      newLateFeeBps: 200,
      newDueDate: schedule.dueDates[0],
      deadline: t4,
      creditorNonce: nextNonce(),
      debtorNonce: nextNonce(),
    };
    const sa = [await creditor.signTypedData(ctx.domain, E.AMENDMENT_TYPES, amend), await debtor.signTypedData(ctx.domain, E.AMENDMENT_TYPES, amend)];
    await at(t4, () => manager.connect(relayer).amend(amend, schedule, ...sa));

    // Forwarder
    const t5 = t4 + 100;
    const data = manager.interface.encodeFunctionData("openDispute", [off.note.noteId, REASON]);
    const req = { from: debtor.address, to: manager.target, gas: 300_000n, nonce: await forwarder.nonces(debtor.address), deadline: t5, data };
    const fsig = await debtor.signTypedData(E.forwarderDomain(ctx.chainId, forwarder.target), E.FORWARD_TYPES, req);
    await at(t5, () => forwarder.connect(relayer).execute(req, fsig));
    expect(await manager.statusOf(off.note.noteId)).to.equal(S.DISPUTED);
  });

  it("aktivasi: cicilan pertama tepat di detik aktivasi ditolak, satu detik setelahnya diterima", async () => {
    const ctx = await loadFixture(fixture);
    const { manager, relayer } = ctx;
    const [creditor, , debtor] = ctx.parties;
    const base = (await time.latest()) + 1000;
    const mk = async (first) => {
      const schedule = { dueDates: [first, base + 10 * DAY], amounts: [IDR(100), IDR(100)] };
      const note = {
        noteId: nextId("act"),
        version: 1,
        creditor: creditor.address,
        debtor: debtor.address,
        docHash: nextId("act-doc"),
        scheduleHash: E.scheduleHash(schedule),
        principal: IDR(100),
        totalOwed: IDR(200),
        lateFeeBps: 200,
        dueDate: schedule.dueDates[1],
        disbursement: 0,
        deadline: base + DAY,
        creditorNonce: nextNonce(),
        debtorNonce: nextNonce(),
      };
      const sigC = await creditor.signTypedData(ctx.domain, E.NOTE_TYPES, note);
      await manager.connect(relayer).depositEscrow(note, sigC, NO_PERMIT);
      return { note, schedule, sigC, sigD: await debtor.signTypedData(ctx.domain, E.NOTE_TYPES, note) };
    };
    const atNow = await mk(base);
    const nextSecond = await mk(base + 101);
    await time.setNextBlockTimestamp(base);
    await expect(manager.connect(relayer).activateOnchain(atNow.note, atNow.schedule, atNow.sigC, atNow.sigD)).to.be.revertedWithCustomError(
      manager,
      "InvalidSchedule"
    );
    await at(base + 100, () => manager.connect(relayer).activateOnchain(nextSecond.note, nextSecond.schedule, nextSecond.sigC, nextSecond.sigD));
    expect(await manager.statusOf(nextSecond.note.noteId)).to.equal(S.ACTIVE);
  });

  it("24 cicilan × 1 sen, telat 10 tahun, checkpoint acak: denda sama persis dengan hitungan sekali jalan", async () => {
    const ctx = await loadFixture(fixture);
    const [creditor, , debtor] = ctx.parties;
    const rng = prng(424242);
    const now = await time.latest();
    const schedule = { dueDates: Array.from({ length: 24 }, (_, i) => now + (i + 1) * 3 * DAY), amounts: Array(24).fill(1n) };
    const a = await openNote(ctx, { creditor, debtor, schedule, principal: 1n }); //  tanpa checkpoint
    const b = await openNote(ctx, { creditor, debtor, schedule: { ...schedule }, principal: 1n }); // checkpoint acak
    // samakan waktu mulai: jadwal identik, aktivasi beda beberapa detik tidak berpengaruh (jatuh tempo sama)
    const end = now + 10 * YEAR;
    let t = await time.latest();
    while (t < end) {
      t += rng.int(1, 120 * DAY);
      if (t > end) t = end;
      await at(t, () => ctx.manager.accrue(b.model.noteId));
      b.model.accrue(t);
    }
    await time.increase(1);
    const tNow = BigInt(await time.latest());
    await expectMatches(ctx, a.model, "tanpa checkpoint");
    await expectMatches(ctx, b.model, "checkpoint acak");
    // Σ 1 sen × detik terlambat × 2% / 30 hari, dibulatkan SEKALI
    let weighted = 0n;
    for (const d of schedule.dueDates) weighted += tNow - BigInt(d);
    const once = (weighted * 200n) / DENOM;
    expect(await ctx.manager.lateFeeOf(a.model.noteId)).to.equal(once);
    expect(await ctx.manager.lateFeeOf(b.model.noteId)).to.equal(once);
  });

  it("nominal maksimum (uint128) × 24 cicilan, telat 50 tahun: tidak overflow, cocok dengan model, bisa dilunasi off-chain", async () => {
    const ctx = await loadFixture(fixture);
    const { manager, relayer, admin } = ctx;
    const [creditor, , debtor] = ctx.parties;
    const now = await time.latest();
    const each = MAX_AMOUNT / 24n;
    const amounts = Array(24).fill(each);
    amounts[23] = MAX_AMOUNT - each * 23n;
    const schedule = { dueDates: Array.from({ length: 24 }, (_, i) => now + (i + 1) * 30 * DAY), amounts };
    const e = await openNote(ctx, { creditor, debtor, schedule, principal: 1n, offchain: true });
    expect(e.note.totalOwed).to.equal(MAX_AMOUNT);

    await time.increaseTo(now + 50 * YEAR);
    await expectMatches(ctx, e.model, "50 tahun");
    // operasi yang dulu bisa overflow tetap jalan
    const ts1 = (await time.latest()) + 1;
    await at(ts1, () => manager.connect(admin).freeze(e.model.noteId, REASON));
    e.model.freeze(ts1);
    const ts2 = ts1 + 1;
    await at(ts2, () => manager.connect(admin).unfreeze(e.model.noteId, REASON));
    e.model.unfreeze(ts2);

    // lunasi lewat konfirmasi off-chain dalam beberapa potongan besar
    for (let i = 0; i < 3 && e.model.status !== S.PAID; i++) {
      const ts = (await time.latest()) + 1;
      const amount = i < 2 ? e.model.outstanding(ts) / 3n : e.model.outstanding(ts);
      const { c, sig } = await signPayment(ctx, creditor, e.model.noteId, amount, ts + DAY);
      await at(ts, () => manager.connect(relayer).recordOffchainPayment(c, sig));
      e.model.pay(amount, false, ts);
      await expectMatches(ctx, e.model, `potongan ${i}`);
    }
    expect(e.model.status).to.equal(S.PAID);
  });

  it("serangan debu: 200 pembayaran 1 sen tidak bisa memangkas denda dan biaya gas per bayar tidak membengkak", async () => {
    const ctx = await loadFixture(fixture);
    const { manager } = ctx;
    const [creditor, , debtor] = ctx.parties;
    const now = await time.latest();
    const e = await openNote(ctx, { creditor, debtor, schedule: { dueDates: [now + DAY, now + 400 * DAY], amounts: [IDR(1_000_000), IDR(1_000_000)] } });
    await time.increaseTo(now + 10 * DAY);
    const gas = [];
    for (let i = 0; i < 200; i++) {
      const ts = (await time.latest()) + 1 + (i % 7) * 600;
      const rc = await at(ts, () => manager.connect(debtor).payOnchain(e.model.noteId, 1n, 0, NO_PERMIT));
      e.model.pay(1n, true, ts);
      gas.push(rc.gasUsed);
    }
    await expectMatches(ctx, e.model, "setelah 200 pembayaran debu");
    expect(gas[199] <= gas[1] + 5_000n, `gas awal ${gas[1]} vs akhir ${gas[199]}`).to.equal(true);
  });

  it("batas gas kasus terburuk: 24 cicilan, semua terlambat, tanpa checkpoint selama 3 tahun", async () => {
    const ctx = await loadFixture(fixture);
    const { manager, admin, freezer } = ctx;
    const [creditor, , debtor] = ctx.parties;
    const now = await time.latest();
    const schedule = { dueDates: Array.from({ length: 24 }, (_, i) => now + (i + 1) * 30 * DAY), amounts: Array(24).fill(IDR(100_000)) };
    // aktivasi 24 cicilan
    const e = await openNote(ctx, { creditor, debtor, schedule });
    await time.increaseTo(now + 3 * YEAR);
    const g = {};
    g.payOnchain = (await (await manager.connect(debtor).payOnchain(e.note.noteId, IDR(1), 0, NO_PERMIT)).wait()).gasUsed;
    await time.increase(YEAR);
    g.freeze = (await (await manager.connect(freezer).freeze(e.note.noteId, REASON)).wait()).gasUsed;
    g.unfreeze = (await (await manager.connect(admin).unfreeze(e.note.noteId, REASON)).wait()).gasUsed;
    await time.increase(YEAR);
    g.openDispute = (await (await manager.connect(creditor).openDispute(e.note.noteId, REASON)).wait()).gasUsed;
    g.statusOf = await manager.statusOf.estimateGas(e.note.noteId);
    g.remaining = await manager.remaining.estimateGas(e.note.noteId);
    console.log(`      gas kasus terburuk: ${Object.entries(g).map(([k, v]) => `${k}=${v}`).join("  ")}`);
    expect(g.payOnchain < 300_000n, "payOnchain").to.equal(true);
    expect(g.freeze < 200_000n, "freeze").to.equal(true);
    expect(g.openDispute < 200_000n, "openDispute").to.equal(true);
    expect(g.statusOf < 150_000n, "statusOf (dipanggil backend/indexer)").to.equal(true);
  });

  it("saat kontrak di-pause: bayar/aktivasi/revisi ditahan, tapi refund, dispute, freeze tetap jalan; denda tetap berjalan", async () => {
    const ctx = await loadFixture(fixture);
    const { manager, relayer, admin, freezer } = ctx;
    const [creditor, , debtor] = ctx.parties;
    const now = await time.latest();
    const e = await openNote(ctx, { creditor, debtor, schedule: { dueDates: [now + DAY], amounts: [IDR(1_000_000)] } });
    const e2 = await openNote(ctx, { creditor, debtor, schedule: { dueDates: [now + DAY], amounts: [IDR(1_000_000)] } });
    // escrow yang sudah disetor sebelum pause
    const schedule = { dueDates: [now + 30 * DAY], amounts: [IDR(1_000)] };
    const pending = {
      noteId: nextId("pause"),
      version: 1,
      creditor: creditor.address,
      debtor: debtor.address,
      docHash: nextId("pause-doc"),
      scheduleHash: E.scheduleHash(schedule),
      principal: IDR(1_000),
      totalOwed: IDR(1_000),
      lateFeeBps: 200,
      dueDate: schedule.dueDates[0],
      disbursement: 0,
      deadline: now + 7 * DAY,
      creditorNonce: nextNonce(),
      debtorNonce: nextNonce(),
    };
    const sigC = await creditor.signTypedData(ctx.domain, E.NOTE_TYPES, pending);
    const sigD = await debtor.signTypedData(ctx.domain, E.NOTE_TYPES, pending);
    await manager.connect(relayer).depositEscrow(pending, sigC, NO_PERMIT);

    await time.increaseTo(now + 5 * DAY);
    await manager.connect(admin).pause();
    const feeBefore = await manager.lateFeeOf(e.note.noteId);
    await expect(manager.connect(debtor).payOnchain(e.note.noteId, IDR(1), 0, NO_PERMIT)).to.be.revertedWithCustomError(manager, "EnforcedPause");
    await expect(manager.connect(relayer).activateOnchain(pending, schedule, sigC, sigD)).to.be.revertedWithCustomError(manager, "EnforcedPause");
    await expect(manager.connect(creditor).markPaid(e.note.noteId)).to.be.revertedWithCustomError(manager, "EnforcedPause");
    await time.increase(10 * DAY);
    expect(await manager.lateFeeOf(e.note.noteId)).to.be.greaterThan(feeBefore); // keterbatasan yang terdokumentasi

    await manager.connect(creditor).refundEscrow(pending);
    await manager.connect(debtor).openDispute(e.note.noteId, REASON);
    await manager.connect(freezer).freeze(e2.note.noteId, REASON);
    await manager.connect(admin).unpause();
    await manager.connect(debtor).payOnchain(e.note.noteId, IDR(1), 0, NO_PERMIT);
    expect(await ctx.idrx.balanceOf(manager.target)).to.equal(0n);
  });
});
