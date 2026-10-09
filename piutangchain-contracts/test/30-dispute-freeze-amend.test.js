const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const f = require("./fixture");
const { ethers, time, E, IDR, DAY, Status, NO_PERMIT } = f;

const REASON = ethers.id("alasan");

async function activeNote(ctx, over = {}) {
  const note = await f.buildNote(ctx, over);
  if (note.disbursement === 1) await f.activateOffchain(ctx, note);
  else await f.activateOnchain(ctx, note);
  return note;
}

describe("Dispute", () => {
  it("kreditur/debitur bisa mengajukan; pihak luar tidak; hanya dari ACTIVE/OVERDUE", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, creditor, debtor, stranger } = ctx;
    const note = await activeNote(ctx);
    await expect(manager.connect(stranger).openDispute(note.noteId, REASON)).to.be.revertedWithCustomError(manager, "NotParty");
    await expect(manager.connect(creditor).openDispute(note.noteId, REASON))
      .to.emit(manager, "DisputeOpened")
      .withArgs(note.noteId, creditor.address, REASON)
      .and.to.emit(manager, "StatusChanged")
      .withArgs(note.noteId, Status.ACTIVE, Status.DISPUTED, creditor.address);
    expect(await manager.statusOf(note.noteId)).to.equal(Status.DISPUTED);
    await expect(manager.connect(debtor).openDispute(note.noteId, REASON))
      .to.be.revertedWithCustomError(manager, "InvalidStatus")
      .withArgs(Status.DISPUTED);
    await expect(manager.connect(creditor).openDispute(ethers.id("x"), REASON)).to.be.revertedWithCustomError(manager, "NoteNotFound");
  });

  it("dari OVERDUE bisa dispute; setelah ditutup kembali ke status semula (OVERDUE)", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, admin, debtor } = ctx;
    const note = await activeNote(ctx);
    await time.increaseTo(note.dueDate + 1);
    expect(await manager.statusOf(note.noteId)).to.equal(Status.OVERDUE);
    await manager.connect(debtor).openDispute(note.noteId, REASON);
    expect(await manager.statusOf(note.noteId)).to.equal(Status.DISPUTED);
    await manager.connect(admin).closeDispute(note.noteId, ethers.id("putusan"));
    expect(await manager.statusOf(note.noteId)).to.equal(Status.OVERDUE);
  });

  it("saat DISPUTED: pembayaran on-chain tetap masuk; konfirmasi off-chain dan 'tandai lunas' ditahan", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, creditor, debtor, relayer } = ctx;
    const note = await activeNote(ctx);
    await manager.connect(debtor).openDispute(note.noteId, REASON);

    await f.payOnchain(ctx, note.noteId, IDR(100_000));
    expect((await manager.getNote(note.noteId)).paid).to.equal(IDR(100_000));

    const { c, sig } = await f.signPayment(ctx, note.noteId, IDR(1000));
    await expect(manager.connect(relayer).recordOffchainPayment(c, sig))
      .to.be.revertedWithCustomError(manager, "InvalidStatus")
      .withArgs(Status.DISPUTED);
    await expect(manager.connect(creditor).markPaid(note.noteId))
      .to.be.revertedWithCustomError(manager, "InvalidStatus")
      .withArgs(Status.DISPUTED);
  });

  it("lunas selama DISPUTED: PAID & burn ditahan sampai admin menutup dispute", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, debtNote, admin, debtor } = ctx;
    const note = await activeNote(ctx);
    await manager.connect(debtor).openDispute(note.noteId, REASON);
    await f.payOnchain(ctx, note.noteId, note.totalOwed);

    let v = await manager.getNote(note.noteId);
    expect(v.fullyPaid).to.equal(true);
    expect(v.status).to.equal(Status.DISPUTED);
    expect(await manager.remaining(note.noteId)).to.equal(0n);
    expect(await debtNote.ownerOf(BigInt(note.noteId))).to.equal(ctx.creditor.address); // belum di-burn
    await expect(f.payOnchain(ctx, note.noteId, 1)).to.be.revertedWithCustomError(manager, "AlreadyFullyPaid");

    await expect(manager.connect(admin).closeDispute(note.noteId, ethers.id("putusan")))
      .to.emit(manager, "DisputeClosed")
      .and.to.emit(manager, "NoteSettled");
    expect(await manager.statusOf(note.noteId)).to.equal(Status.PAID);
    await expect(debtNote.ownerOf(BigInt(note.noteId))).to.be.revertedWithCustomError(debtNote, "NonexistentToken");
  });

  it("lunas tepat waktu saat dispute tidak kena denda walau dispute ditutup setelah jatuh tempo", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, admin, debtor } = ctx;
    const note = await activeNote(ctx);
    await manager.connect(debtor).openDispute(note.noteId, REASON);
    await f.payOnchain(ctx, note.noteId, note.totalOwed); // sebelum jatuh tempo
    await time.increaseTo(note.dueDate + 10 * DAY);
    expect(await manager.remaining(note.noteId)).to.equal(0n);
    await manager.connect(admin).closeDispute(note.noteId, ethers.id("putusan"));
    expect(await manager.statusOf(note.noteId)).to.equal(Status.PAID);
  });

  it("closeDispute hanya ADMIN dan hanya dari DISPUTED", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, admin, creditor, freezer } = ctx;
    const note = await activeNote(ctx);
    await expect(manager.connect(admin).closeDispute(note.noteId, REASON))
      .to.be.revertedWithCustomError(manager, "InvalidStatus")
      .withArgs(Status.ACTIVE);
    await manager.connect(creditor).openDispute(note.noteId, REASON);
    await expect(manager.connect(creditor).closeDispute(note.noteId, REASON)).to.be.revertedWithCustomError(
      manager,
      "AccessControlUnauthorizedAccount"
    );
    await expect(manager.connect(freezer).closeDispute(note.noteId, REASON)).to.be.revertedWithCustomError(
      manager,
      "AccessControlUnauthorizedAccount"
    );
  });
});

describe("Freeze / integrity checker", () => {
  it("FREEZER (integrity checker) bisa freeze tapi tidak bisa unfreeze; pihak luar tidak bisa freeze", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, admin, freezer, stranger, creditor } = ctx;
    const note = await activeNote(ctx);
    await expect(manager.connect(stranger).freeze(note.noteId, REASON)).to.be.revertedWithCustomError(
      manager,
      "AccessControlUnauthorizedAccount"
    );
    await expect(manager.connect(creditor).freeze(note.noteId, REASON)).to.be.revertedWithCustomError(
      manager,
      "AccessControlUnauthorizedAccount"
    );
    await expect(manager.connect(freezer).freeze(note.noteId, REASON))
      .to.emit(manager, "NoteFrozen")
      .withArgs(note.noteId, freezer.address, REASON)
      .and.to.emit(manager, "StatusChanged")
      .withArgs(note.noteId, Status.ACTIVE, Status.FROZEN, freezer.address);
    expect(await manager.statusOf(note.noteId)).to.equal(Status.FROZEN);

    await expect(manager.connect(freezer).unfreeze(note.noteId, REASON)).to.be.revertedWithCustomError(
      manager,
      "AccessControlUnauthorizedAccount"
    );
    await expect(manager.connect(freezer).freeze(note.noteId, REASON))
      .to.be.revertedWithCustomError(manager, "InvalidStatus")
      .withArgs(Status.FROZEN);
    await expect(manager.connect(admin).unfreeze(note.noteId, ethers.id("data diperbaiki")))
      .to.emit(manager, "NoteUnfrozen")
      .withArgs(note.noteId, admin.address, ethers.id("data diperbaiki"), Status.ACTIVE);
    expect(await manager.statusOf(note.noteId)).to.equal(Status.ACTIVE);
    await expect(manager.connect(admin).unfreeze(note.noteId, REASON)).to.be.revertedWithCustomError(manager, "InvalidStatus");
  });

  it("FROZEN menolak: pembayaran on-chain & off-chain, tandai lunas, revisi, dispute baru, dan burn", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, debtNote, creditor, debtor, freezer, relayer } = ctx;
    const note = await activeNote(ctx);
    await manager.connect(freezer).freeze(note.noteId, REASON);

    const frozen = (p) => expect(p).to.be.revertedWithCustomError(manager, "InvalidStatus").withArgs(Status.FROZEN);
    await frozen(f.payOnchain(ctx, note.noteId, IDR(1000)));
    const pay = await f.signPayment(ctx, note.noteId, IDR(1000));
    await frozen(manager.connect(relayer).recordOffchainPayment(pay.c, pay.sig));
    await frozen(manager.connect(creditor).markPaid(note.noteId));
    await frozen(manager.connect(debtor).openDispute(note.noteId, REASON));
    const am = await signAmendment(ctx, note, { newDocHash: ethers.id("doc-baru") });
    await frozen(amendWith(manager.connect(relayer), am.a, am.sigC, am.sigD));
    // token tetap ada
    expect(await debtNote.ownerOf(BigInt(note.noteId))).to.equal(creditor.address);
  });

  it("freeze dari DISPUTED lalu unfreeze → kembali DISPUTED; lunas saat dispute lalu freeze/unfreeze/close → PAID", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, admin, freezer, debtor } = ctx;
    const note = await activeNote(ctx);
    await manager.connect(debtor).openDispute(note.noteId, REASON);
    await f.payOnchain(ctx, note.noteId, note.totalOwed);
    await manager.connect(freezer).freeze(note.noteId, REASON);
    await expect(manager.connect(admin).unfreeze(note.noteId, REASON)).to.emit(manager, "NoteUnfrozen").withArgs(
      note.noteId,
      admin.address,
      REASON,
      Status.DISPUTED
    );
    expect(await manager.statusOf(note.noteId)).to.equal(Status.DISPUTED);
    await manager.connect(admin).closeDispute(note.noteId, REASON);
    expect(await manager.statusOf(note.noteId)).to.equal(Status.PAID);
  });

  it("piutang PAID dan yang tidak ada tidak bisa dibekukan; ADMIN juga boleh freeze", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, admin } = ctx;
    const note = await activeNote(ctx);
    await f.payOnchain(ctx, note.noteId, note.totalOwed);
    await expect(manager.connect(admin).freeze(note.noteId, REASON))
      .to.be.revertedWithCustomError(manager, "InvalidStatus")
      .withArgs(Status.PAID);
    await expect(manager.connect(admin).freeze(ethers.id("x"), REASON)).to.be.revertedWithCustomError(manager, "NoteNotFound");
    const other = await activeNote(ctx);
    await manager.connect(admin).freeze(other.noteId, REASON);
    expect(await manager.statusOf(other.noteId)).to.equal(Status.FROZEN);
  });

  it("integrity check end-to-end: hash database berbeda → backend freeze → pembayaran berhenti", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, freezer } = ctx;
    const note = await activeNote(ctx);
    const dbHashTampered = ethers.id("isi dokumen diubah di database");
    if (!(await manager.verifyHash(note.noteId, dbHashTampered))) {
      await manager.connect(freezer).freeze(note.noteId, dbHashTampered);
    }
    expect(await manager.statusOf(note.noteId)).to.equal(Status.FROZEN);
    await expect(f.payOnchain(ctx, note.noteId, IDR(1))).to.be.revertedWithCustomError(manager, "InvalidStatus");
  });
});

/** Jadwal revisi default: satu cicilan sebesar newTotalOwed di newDueDate. */
const amendSchedule = (a) => ({ dueDates: [a.newDueDate], amounts: [a.newTotalOwed] });
const amendWith = (m, a, sigC, sigD, schedule = amendSchedule(a)) => m.amend(a, schedule, sigC, sigD);

async function signAmendment(ctx, note, over = {}) {
  const now = await time.latest();
  const a = {
    noteId: note.noteId,
    newVersion: 2,
    newDocHash: ethers.id("doc-revisi"),
    newScheduleHash: ethers.ZeroHash,
    newTotalOwed: note.totalOwed,
    newLateFeeBps: note.lateFeeBps,
    newDueDate: note.dueDate + 30 * DAY,
    deadline: now + 7 * DAY,
    creditorNonce: 910_000n + BigInt(Math.floor(Math.random() * 1e6)),
    debtorNonce: 920_000n + BigInt(Math.floor(Math.random() * 1e6)),
    ...over,
  };
  if (!("newScheduleHash" in over)) a.newScheduleHash = E.scheduleHash(amendSchedule(a));
  const sigC = await ctx.creditor.signTypedData(ctx.domain, E.AMENDMENT_TYPES, a);
  const sigD = await ctx.debtor.signTypedData(ctx.domain, E.AMENDMENT_TYPES, a);
  return { a, sigC, sigD };
}

describe("Revisi setelah ACTIVE (amend, ditandatangani ulang kedua pihak)", () => {
  it("memperpanjang jatuh tempo & ganti hash dokumen; versi naik; hash lama tetap terkunci; pokok tidak berubah", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, relayer } = ctx;
    const note = await activeNote(ctx, { lateFeeBps: 0 });
    await time.increaseTo(note.dueDate + 1);
    expect(await manager.statusOf(note.noteId)).to.equal(Status.OVERDUE);

    const { a, sigC, sigD } = await signAmendment(ctx, note, { newDueDate: (await time.latest()) + 20 * DAY });
    await expect(amendWith(manager.connect(relayer), a, sigC, sigD))
      .to.emit(manager, "NoteAmended")
      .withArgs(note.noteId, 2, note.docHash, a.newDocHash, a.newScheduleHash, a.newTotalOwed, a.newLateFeeBps, a.newDueDate);

    const v = await manager.getNote(note.noteId);
    expect(v.version).to.equal(2);
    expect(v.docHash).to.equal(a.newDocHash);
    expect(v.principal).to.equal(note.principal);
    expect(v.status).to.equal(Status.ACTIVE); // OVERDUE hilang karena jatuh tempo baru
    expect(await manager.verifyHash(note.noteId, a.newDocHash)).to.equal(true);
    expect(await manager.verifyHash(note.noteId, note.docHash)).to.equal(false);
    expect(await manager.noteIdOfDocHash(note.docHash)).to.equal(note.noteId); // hash lama tidak bisa dipakai ulang
    expect(await manager.noteIdOfDocHash(a.newDocHash)).to.equal(note.noteId);
  });

  it("revisi yang menurunkan total di bawah yang sudah dibayar → langsung PAID + burn", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, debtNote, relayer } = ctx;
    const note = await activeNote(ctx);
    await f.payOnchain(ctx, note.noteId, IDR(700_000));
    const { a, sigC, sigD } = await signAmendment(ctx, note, { newTotalOwed: IDR(700_000) });
    await expect(amendWith(manager.connect(relayer), a, sigC, sigD)).to.emit(manager, "NoteSettled");
    expect(await manager.statusOf(note.noteId)).to.equal(Status.PAID);
    await expect(debtNote.ownerOf(BigInt(note.noteId))).to.be.revertedWithCustomError(debtNote, "NonexistentToken");
  });

  it("saat DISPUTED revisi diperbolehkan (jalan keluar sengketa) dan bisa membatalkan status 'lunas' yang tertahan", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, creditor, relayer } = ctx;
    const note = await activeNote(ctx);
    await manager.connect(creditor).openDispute(note.noteId, REASON);
    await f.payOnchain(ctx, note.noteId, note.totalOwed);
    expect((await manager.getNote(note.noteId)).fullyPaid).to.equal(true);

    const { a, sigC, sigD } = await signAmendment(ctx, note, { newTotalOwed: note.totalOwed + IDR(50_000) });
    await amendWith(manager.connect(relayer), a, sigC, sigD);
    const v = await manager.getNote(note.noteId);
    expect(v.fullyPaid).to.equal(false);
    expect(v.status).to.equal(Status.DISPUTED);
    expect(await manager.remaining(note.noteId)).to.equal(IDR(50_000));
  });

  it("menolak: versi salah, signature salah/kurang, hash dipakai, field nol, kedaluwarsa, nonce ganda, bukan ACTIVE", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, relayer, stranger } = ctx;
    const note = await activeNote(ctx);
    const other = await activeNote(ctx);

    let r = await signAmendment(ctx, note, { newVersion: 3 });
    await expect(amendWith(manager.connect(relayer), r.a, r.sigC, r.sigD))
      .to.be.revertedWithCustomError(manager, "InvalidVersion")
      .withArgs(2);

    r = await signAmendment(ctx, note);
    const fake = await stranger.signTypedData(ctx.domain, E.AMENDMENT_TYPES, r.a);
    await expect(amendWith(manager.connect(relayer), r.a, r.sigC, fake)).to.be.revertedWithCustomError(manager, "InvalidSignature");
    await expect(amendWith(manager.connect(relayer), { ...r.a, newTotalOwed: r.a.newTotalOwed + 1n }, r.sigC, r.sigD)).to.be.revertedWithCustomError(
      manager,
      "InvalidSignature"
    );

    r = await signAmendment(ctx, note, { newDocHash: other.docHash });
    await expect(amendWith(manager.connect(relayer), r.a, r.sigC, r.sigD)).to.be.revertedWithCustomError(manager, "DocHashAlreadyUsed");
    r = await signAmendment(ctx, note, { newDocHash: note.docHash });
    await expect(amendWith(manager.connect(relayer), r.a, r.sigC, r.sigD)).to.be.revertedWithCustomError(manager, "DocHashAlreadyUsed");

    for (const over of [{ newDocHash: ethers.ZeroHash }, { newTotalOwed: 0n }, { newDueDate: 0 }]) {
      r = await signAmendment(ctx, note, over);
      await expect(amendWith(manager.connect(relayer), r.a, r.sigC, r.sigD)).to.be.revertedWithCustomError(manager, "InvalidAmount");
    }

    r = await signAmendment(ctx, note, { deadline: (await time.latest()) - 1 });
    await expect(amendWith(manager.connect(relayer), r.a, r.sigC, r.sigD)).to.be.revertedWithCustomError(manager, "SignatureExpired");

    // sukses sekali, replay ditolak (versi sudah naik)
    r = await signAmendment(ctx, note);
    await amendWith(manager.connect(relayer), r.a, r.sigC, r.sigD);
    await expect(amendWith(manager.connect(relayer), r.a, r.sigC, r.sigD)).to.be.revertedWithCustomError(manager, "InvalidVersion");
    // nonce kreditur dipakai ulang untuk versi berikutnya
    const again = await signAmendment(ctx, note, {
      newVersion: 3,
      newDocHash: ethers.id("doc-v3"),
      creditorNonce: r.a.creditorNonce,
    });
    await expect(amendWith(manager.connect(relayer), again.a, again.sigC, again.sigD)).to.be.revertedWithCustomError(
      manager,
      "NonceAlreadyUsed"
    );

    // sudah PAID → tidak bisa direvisi
    await f.payOnchain(ctx, other.noteId, other.totalOwed);
    const paid = await signAmendment(ctx, other, { newDocHash: ethers.id("doc-paid") });
    await expect(amendWith(manager.connect(relayer), paid.a, paid.sigC, paid.sigD))
      .to.be.revertedWithCustomError(manager, "InvalidStatus")
      .withArgs(Status.PAID);
    await expect(amendWith(manager.connect(relayer), { ...paid.a, noteId: ethers.id("x") }, paid.sigC, paid.sigD)).to.be.revertedWithCustomError(
      manager,
      "NoteNotFound"
    );
  });
});

describe("Meta-transaction untuk aksi pengguna (gasless seluruh alur)", () => {
  it("dispute, markPaid, dan cancelNonce lewat forwarder memakai identitas penanda tangan", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, forwarder, creditor, debtor, relayer } = ctx;
    const note = await activeNote(ctx, { disbursement: 1 });

    const exec = async (signer, fn, args) => {
      const req = {
        from: signer.address,
        to: manager.target,
        gas: 600_000n,
        nonce: await forwarder.nonces(signer.address),
        deadline: (await time.latest()) + DAY,
        data: manager.interface.encodeFunctionData(fn, args),
      };
      const sig = await signer.signTypedData(E.forwarderDomain(ctx.chainId, forwarder.target), E.FORWARD_TYPES, req);
      return forwarder.connect(relayer).execute(req, sig);
    };

    await exec(debtor, "openDispute", [note.noteId, REASON]);
    expect(await manager.statusOf(note.noteId)).to.equal(Status.DISPUTED);
    await exec(creditor, "cancelNonce", [123456n]);
    expect(await manager.nonceUsed(creditor.address, 123456n)).to.equal(true);

    await manager.connect(ctx.admin).closeDispute(note.noteId, REASON);
    await exec(creditor, "markPaid", [note.noteId]);
    expect(await manager.statusOf(note.noteId)).to.equal(Status.PAID);
  });
});
