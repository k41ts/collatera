const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const f = require("./fixture");
const { ethers, time, E, IDR, DAY, Status } = f;

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

describe("T3: dispute tidak boleh menjadi alat menghindari denda (BR-21a)", () => {
  const REASON = ethers.id("alasan");
  const RES = ethers.id("putusan");
  const DEN = 10_000n * 30n * 86400n;
  // denda murni dari satu cicilan Rp1.100.000 (110.000.000 satuan) yang sudah jatuh tempo, selama `secs` detik
  const feeFor = (secs) => (110_000_000n * 200n * BigInt(secs)) / DEN;

  /** Note satu cicilan; waktu dimajukan ke `lateDays` hari setelah jatuh tempo. */
  async function overdue(ctx, lateDays) {
    const note = await f.buildNote(ctx);
    await f.activateOnchain(ctx, note);
    await time.increaseTo(Number(note.dueDate) + lateDays * DAY);
    return note;
  }
  async function openAt(ctx, note, who, t) {
    await time.setNextBlockTimestamp(t);
    await ctx.manager.connect(who).openDispute(note.noteId, REASON);
  }

  it("debitur membuka dispute saat OVERDUE lalu diam 100 hari: denda TERUS naik", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, debtor } = ctx;
    const note = await overdue(ctx, 5);
    const t0 = (await time.latest()) + 1;
    await openAt(ctx, note, debtor, t0);
    expect(await manager.statusOf(note.noteId)).to.equal(Status.DISPUTED);
    const before = await manager.lateFeeOf(note.noteId);

    await time.increase(100 * DAY);
    const now = await time.latest();
    const after = await manager.lateFeeOf(note.noteId);
    expect(after).to.be.gt(before + feeFor(99 * DAY));
    const elapsed = now - Number(note.dueDate);
    expect(after).to.be.gte(feeFor(elapsed));
    expect(after).to.be.lte(feeFor(elapsed + 3));
  });

  it("admin menutup dengan waiveFee: tepat porsi periode dispute dihapus, denda sebelum dispute utuh", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, creditor, admin } = ctx;
    const note = await overdue(ctx, 15);
    const t0 = (await time.latest()) + 10;
    await openAt(ctx, note, creditor, t0);
    const preFee = await manager.lateFeeOf(note.noteId);
    expect(preFee).to.be.gte(feeFor(15 * DAY));

    const t1 = t0 + 40 * DAY;
    await time.setNextBlockTimestamp(t1);
    const tx = manager.connect(admin).closeDispute(note.noteId, RES, true);
    const totalAtClose = feeFor(t1 - Number(note.dueDate));
    await expect(tx).to.emit(manager, "LateFeeWaived").withArgs(note.noteId, totalAtClose - preFee);
    await expect(tx).to.emit(manager, "DisputeClosed");

    expect(await manager.lateFeeOf(note.noteId)).to.equal(preFee);
    expect(await manager.statusOf(note.noteId)).to.equal(Status.OVERDUE);
  });

  it("closeDispute tanpa waiveFee: denda periode dispute tetap terutang", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, debtor, admin } = ctx;
    const note = await overdue(ctx, 15);
    const t0 = (await time.latest()) + 10;
    await openAt(ctx, note, debtor, t0);
    const t1 = t0 + 40 * DAY;
    await time.setNextBlockTimestamp(t1);
    await expect(manager.connect(admin).closeDispute(note.noteId, RES, false)).to.not.emit(manager, "LateFeeWaived");
    expect(await manager.lateFeeOf(note.noteId)).to.equal(feeFor(t1 - Number(note.dueDate)));
  });

  it("waiveFee dibatasi sisa denda: denda yang sudah dibayar debitur tidak dihapus dua kali", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, debtor, admin } = ctx;
    const note = await overdue(ctx, 15);
    const t0 = (await time.latest()) + 10;
    await openAt(ctx, note, debtor, t0);
    const preFee = await manager.lateFeeOf(note.noteId);

    await time.setNextBlockTimestamp(t0 + 30 * DAY);
    await manager.accrue(note.noteId);
    const total = await manager.lateFeeOf(note.noteId);
    const disputeFee = total - preFee;
    const pay = note.totalOwed + preFee + disputeFee / 2n;
    await f.payOnchain(ctx, note.noteId, pay);
    const leftFee = await manager.lateFeeOf(note.noteId);
    expect(leftFee).to.be.gt(0n);

    await manager.connect(admin).closeDispute(note.noteId, RES, true);
    expect(await manager.lateFeeOf(note.noteId)).to.equal(0n);
    // tunggakan nol + denda nol setelah waive → langsung lunas (tidak tertahan di ACTIVE dengan sisa 0)
    expect(await manager.statusOf(note.noteId)).to.equal(Status.PAID);
  });

  it("closeExpiredDispute: ditolak sebelum 14 hari, berhasil sesudahnya oleh siapa pun, tanpa waive", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, creditor, stranger } = ctx;
    expect(await manager.DISPUTE_WINDOW()).to.equal(14n * 86400n);
    const note = await overdue(ctx, 5);
    const t0 = (await time.latest()) + 10;
    await openAt(ctx, note, creditor, t0);

    await expect(manager.connect(stranger).closeExpiredDispute(note.noteId)).to.be.revertedWithCustomError(manager, "DisputeWindowNotElapsed");
    await time.setNextBlockTimestamp(t0 + 14 * DAY - 1);
    await expect(manager.connect(stranger).closeExpiredDispute(note.noteId)).to.be.revertedWithCustomError(manager, "DisputeWindowNotElapsed");

    await time.setNextBlockTimestamp(t0 + 14 * DAY + 5);
    const tx = manager.connect(stranger).closeExpiredDispute(note.noteId);
    await expect(tx).to.emit(manager, "DisputeClosed").withArgs(note.noteId, stranger.address, ethers.ZeroHash);
    await expect(tx).to.not.emit(manager, "LateFeeWaived");
    expect(await manager.statusOf(note.noteId)).to.equal(Status.OVERDUE);
    expect(await manager.lateFeeOf(note.noteId)).to.be.gte(feeFor(t0 + 14 * DAY - Number(note.dueDate)));

    await expect(manager.connect(stranger).closeExpiredDispute(note.noteId)).to.be.revertedWithCustomError(manager, "InvalidStatus");
  });

  it("closeExpiredDispute pada sengketa yang sudah dibayar penuh → PAID + burn", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, debtor, stranger, debtNote } = ctx;
    const note = await overdue(ctx, 5);
    await manager.connect(debtor).openDispute(note.noteId, REASON);
    await f.payOnchain(ctx, note.noteId, note.totalOwed * 2n); // dipotong ke sisa utang
    expect(await manager.statusOf(note.noteId)).to.equal(Status.DISPUTED);
    await time.increase(15 * DAY);
    await manager.connect(stranger).closeExpiredDispute(note.noteId);
    expect(await manager.statusOf(note.noteId)).to.equal(Status.PAID);
    await expect(debtNote.ownerOf(BigInt(note.noteId))).to.be.reverted;
  });

  it("dispute kedua pada note yang sama: boleh, tapi tidak mereset denda yang sudah ada", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, debtor, creditor, admin, stranger } = ctx;
    const note = await overdue(ctx, 5);
    const t0 = (await time.latest()) + 10;
    await openAt(ctx, note, debtor, t0);
    await time.setNextBlockTimestamp(t0 + 14 * DAY);
    await manager.connect(stranger).closeExpiredDispute(note.noteId); // tanpa waive: denda dispute #1 tetap

    const t2 = t0 + 20 * DAY;
    await openAt(ctx, note, creditor, t2);
    const feeAtSecondOpen = await manager.lateFeeOf(note.noteId);
    expect(feeAtSecondOpen).to.be.gte(feeFor(t2 - Number(note.dueDate)));

    await time.setNextBlockTimestamp(t2 + 30 * DAY);
    await manager.connect(admin).closeDispute(note.noteId, RES, true);
    // hanya porsi dispute #2 yang dihapus; denda sampai dispute #2 dibuka (termasuk periode dispute #1) utuh
    expect(await manager.lateFeeOf(note.noteId)).to.equal(feeAtSecondOpen);
  });

  it("FROZEN tetap menghentikan denda (aturan lama), termasuk dibekukan dari DISPUTED", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, debtor, admin } = ctx;
    const note = await overdue(ctx, 5);
    await manager.connect(debtor).openDispute(note.noteId, REASON);
    await time.increase(2 * DAY);
    await manager.connect(admin).freeze(note.noteId, REASON);
    const frozenFee = await manager.lateFeeOf(note.noteId);
    await time.increase(30 * DAY);
    expect(await manager.lateFeeOf(note.noteId)).to.equal(frozenFee);
    await manager.connect(admin).unfreeze(note.noteId, REASON);
    expect(await manager.statusOf(note.noteId)).to.equal(Status.DISPUTED);
    await time.increase(DAY);
    expect(await manager.lateFeeOf(note.noteId)).to.be.gt(frozenFee);
  });
});

describe("T4: pause tidak boleh menghukum debitur (opsi fallback: payOnchain tetap boleh saat pause)", () => {
  it("pause 30 hari saat OVERDUE: debitur tetap bisa membayar on-chain dan melunasi; fungsi lain tetap tertahan", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, admin, creditor, debtor, idrx, debtNote } = ctx;
    const note = await f.buildNote(ctx);
    await f.activateOnchain(ctx, note);
    await time.increaseTo(Number(note.dueDate) + 5 * DAY);
    await manager.connect(admin).pause();
    await time.increase(30 * DAY);

    // fungsi lain tetap whenNotPaused
    await expect(manager.connect(creditor).markPaid(note.noteId)).to.be.revertedWithCustomError(manager, "EnforcedPause");
    const { c, sig } = await f.signPayment(ctx, note.noteId, IDR(1_000));
    await expect(manager.recordOffchainPayment(c, sig)).to.be.revertedWithCustomError(manager, "EnforcedPause");

    // debitur membayar sebagian lalu lunas, tanpa harus menunggu unpause
    const credBefore = await idrx.balanceOf(creditor.address);
    await f.payOnchain(ctx, note.noteId, IDR(100_000));
    expect(await idrx.balanceOf(creditor.address)).to.equal(credBefore + IDR(100_000));
    await f.payOnchain(ctx, note.noteId, note.totalOwed * 3n); // dipotong ke sisa utang
    expect(await manager.statusOf(note.noteId)).to.equal(Status.PAID);
    expect(await manager.remaining(note.noteId)).to.equal(0n);
    await expect(debtNote.ownerOf(BigInt(note.noteId))).to.be.reverted;
  });

  it("unpause melanjutkan normal; hanya debitur yang boleh membayar saat pause", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, admin, creditor, debtor, stranger } = ctx;
    const note = await f.buildNote(ctx);
    await f.activateOnchain(ctx, note);
    await manager.connect(admin).pause();
    await expect(manager.connect(stranger).payOnchain(note.noteId, 1, 1, f.NO_PERMIT)).to.be.revertedWithCustomError(manager, "NotDebtor");
    await manager.connect(admin).unpause();
    await f.payOnchain(ctx, note.noteId, IDR(100_000));
    await expect(manager.connect(creditor).markPaid(note.noteId)).to.emit(manager, "NoteMarkedPaid");
  });
});

describe("T5: forwarder hanya ke DebtManager dan return data dibatasi", () => {
  const sign = (ctx, fwd, signer, r) => signer.signTypedData(E.forwarderDomain(ctx.chainId, fwd.target), E.FORWARD_TYPES, r);

  it("manager diset satu kali oleh deployer; alamat nol / bukan kontrak / pemanggil lain ditolak", async () => {
    const ctx = await loadFixture(f.deployAll);
    const fwd = await ethers.deployContract("PiutangForwarder");
    expect(await fwd.manager()).to.equal(ethers.ZeroAddress);
    await expect(fwd.connect(ctx.stranger).setManager(ctx.manager.target)).to.be.revertedWithCustomError(fwd, "NotDeployer");
    await expect(fwd.setManager(ethers.ZeroAddress)).to.be.revertedWithCustomError(fwd, "TargetNotContract");
    await expect(fwd.setManager(ctx.stranger.address)).to.be.revertedWithCustomError(fwd, "TargetNotContract");
    await expect(fwd.setManager(ctx.manager.target)).to.emit(fwd, "ManagerSet").withArgs(ctx.manager.target);
    await expect(fwd.setManager(ctx.idrx.target)).to.be.revertedWithCustomError(fwd, "ManagerAlreadySet");
    // forwarder fixture sudah terhubung ke manager
    expect(await ctx.forwarder.manager()).to.equal(ctx.manager.target);
  });

  it("`to` selain DebtManager ditolak (token, kontrak lain, EOA), bahkan dengan signature sah", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { forwarder, debtor, relayer, idrx } = ctx;
    for (const to of [idrx.target, ctx.debtNote.target, ctx.stranger.address, ethers.ZeroAddress]) {
      const r = {
        from: debtor.address,
        to,
        gas: 200_000n,
        nonce: await forwarder.nonces(debtor.address),
        deadline: (await time.latest()) + DAY,
        data: idrx.interface.encodeFunctionData("transfer", [ctx.stranger.address, 1n]),
      };
      await expect(forwarder.connect(relayer).execute(r, await sign(ctx, forwarder, debtor, r)), to).to.be.revertedWithCustomError(
        forwarder,
        "TargetNotAllowed"
      );
    }
    expect(await forwarder.nonces(debtor.address)).to.equal(0n);
  });

  async function bombForwarder(ctx, size) {
    const bomb = await ethers.deployContract("MockReturnBomb", [size]);
    const fwd = await ethers.deployContract("PiutangForwarder");
    await fwd.setManager(bomb.target);
    return { bomb, fwd };
  }
  const bombReq = async (ctx, fwd, bomb, data) => ({
    from: ctx.debtor.address,
    to: bomb.target,
    gas: 3_000_000n,
    nonce: await fwd.nonces(ctx.debtor.address),
    deadline: (await time.latest()) + DAY,
    data,
  });

  it("return data besar dipotong 4 KB: relayer tidak membayar salinan ratusan KB", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { bomb, fwd } = await bombForwarder(ctx, 100_000);
    const r = await bombReq(ctx, fwd, bomb, "0x02");
    const sig = await sign(ctx, fwd, ctx.debtor, r);
    const ret = await fwd.connect(ctx.relayer).execute.staticCall(r, sig);
    expect(ethers.dataLength(ret)).to.equal(4096);
    const rc = await (await fwd.connect(ctx.relayer).execute(r, sig)).wait();
    // biaya target (ekspansi memori 100 KB ≈ 30 rb gas) + overhead; salinan penuh akan jauh lebih mahal
    expect(rc.gasUsed).to.be.lt(200_000n);
  });

  it("revert data besar: tetap diteruskan apa adanya tetapi dibatasi 4 KB", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { bomb, fwd } = await bombForwarder(ctx, 100_000);
    const r = await bombReq(ctx, fwd, bomb, "0x01");
    const sig = await sign(ctx, fwd, ctx.debtor, r);
    let data;
    try {
      await fwd.connect(ctx.relayer).execute.staticCall(r, sig);
    } catch (e) {
      data = e.data;
    }
    expect(data, "harus revert dengan data").to.not.equal(undefined);
    expect(ethers.dataLength(data)).to.equal(4096);
  });

  it("revert kecil dari manager tetap diteruskan utuh (custom error)", async () => {
    const ctx = await loadFixture(f.deployAll);
    const data = ctx.manager.interface.encodeFunctionData("openDispute", [ethers.id("tidak-ada"), ethers.id("x")]);
    const r = {
      from: ctx.debtor.address,
      to: ctx.manager.target,
      gas: 500_000n,
      nonce: 0n,
      deadline: (await time.latest()) + DAY,
      data,
    };
    await expect(ctx.forwarder.execute(r, await sign(ctx, ctx.forwarder, ctx.debtor, r))).to.be.revertedWithCustomError(
      ctx.manager,
      "NoteNotFound"
    );
  });
});

describe("T6: deploy.js — FREEZER_ROLE jelas dan peringatan admin tunggal", () => {
  const deployScript = require("../scripts/deploy.js");
  const A = "0x000000000000000000000000000000000000dEaD";
  const B = "0x000000000000000000000000000000000000bEEF";

  it("peringatan keras bila admin == deployer di network selain hardhat/localhost", () => {
    const w = deployScript.deployWarnings({ networkName: "sepolia", admin: A, deployer: A, freezer: undefined });
    expect(w.join("\n")).to.match(/ADMIN == DEPLOYER/);
    expect(deployScript.deployWarnings({ networkName: "hardhat", admin: A, deployer: A }).length).to.equal(0);
    expect(deployScript.deployWarnings({ networkName: "localhost", admin: A, deployer: A }).length).to.equal(0);
    expect(deployScript.deployWarnings({ networkName: "sepolia", admin: B, deployer: A }).length).to.equal(0);
  });

  it("admin bukan deployer + FREEZER_ADDRESS: peringatan memuat perintah grant manual yang jelas", () => {
    const w = deployScript.deployWarnings({ networkName: "sepolia", admin: B, deployer: A, freezer: A });
    expect(w.join("\n")).to.match(/grantRole/);
    expect(w.join("\n")).to.include(A);
  });

  it("deploy dengan FREEZER_ADDRESS memberi FREEZER_ROLE dan memverifikasinya on-chain", async () => {
    const ctx = await loadFixture(f.deployAll);
    process.env.FREEZER_ADDRESS = ctx.freezer.address;
    try {
      const res = await deployScript.main({ quiet: true, writeFile: false });
      const manager = await ethers.getContractAt("DebtManager", res.manager);
      expect(await manager.hasRole(f.FREEZER_ROLE, ctx.freezer.address)).to.equal(true);
      const forwarder = await ethers.getContractAt("PiutangForwarder", res.forwarder);
      expect(await forwarder.manager()).to.equal(res.manager);
    } finally {
      delete process.env.FREEZER_ADDRESS;
    }
  });
});
