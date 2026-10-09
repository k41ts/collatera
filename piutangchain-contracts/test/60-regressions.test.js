const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const f = require("./fixture");
const { ethers, time, IDR, DAY, NO_PERMIT, Status } = f;

describe("Regresi: refund escrow membatalkan signature kreditur", () => {
  it("setelah refund, signature lama tidak bisa dipakai untuk setor ulang dan aktivasi", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, idrx, creditor, debtor, stranger } = ctx;
    const note = await f.buildNote(ctx);
    const sigC = await f.signNote(creditor, ctx, note);

    // allowance tersisa (approve biasa / sisa permit dari pembayaran lain)
    await idrx.connect(creditor).approve(manager.target, ethers.MaxUint256);
    await manager.connect(stranger).depositEscrow(note, sigC, NO_PERMIT);

    await expect(manager.connect(creditor).refundEscrow(note))
      .to.emit(manager, "NonceCancelled")
      .withArgs(creditor.address, note.creditorNonce);
    expect(await manager.nonceUsed(creditor.address, note.creditorNonce)).to.equal(true);

    const sigD = await f.signNote(debtor, ctx, note);
    await expect(manager.connect(stranger).depositEscrow(note, sigC, NO_PERMIT)).to.be.revertedWithCustomError(
      manager,
      "NonceAlreadyUsed"
    );
    await expect(
      manager.connect(stranger).activateOnchain(note, f.scheduleOf(note), sigC, sigD)
    ).to.be.revertedWithCustomError(manager, "EscrowMissing");
    expect(await manager.statusOf(note.noteId)).to.equal(Status.NONE);
  });

  it("refund tetap jalan walau kreditur sudah cancelNonce lebih dulu", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, idrx, creditor } = ctx;
    const note = await f.buildNote(ctx);
    const sigC = await f.signNote(creditor, ctx, note);
    const permit = await f.signPermit(idrx, creditor, manager.target, note.principal, note.deadline);
    await manager.depositEscrow(note, sigC, permit);

    await manager.connect(creditor).cancelNonce(note.creditorNonce);
    await expect(manager.connect(creditor).refundEscrow(note))
      .to.emit(manager, "EscrowRefunded")
      .and.not.to.emit(manager, "NonceCancelled");
  });
});

describe("Regresi: denda tidak bisa dihapus dengan memanggil accrue() terus-menerus", () => {
  it("accrue tiap blok menghasilkan denda yang sama dengan tanpa accrue", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, stranger } = ctx;
    // tunggakan kecil: per blok dendanya < 1 satuan terkecil, dulu selalu dibulatkan ke 0
    const mk = () => f.buildNote(ctx, { principal: IDR(100_000), totalOwed: IDR(100_000) });
    const spam = await mk();
    const control = await mk();
    await f.activateOnchain(ctx, spam);
    await f.activateOnchain(ctx, control);
    await time.increaseTo(Number(spam.dueDate) + 1);

    for (let i = 0; i < 200; i++) {
      await time.increase(11);
      await manager.connect(stranger).accrue(spam.noteId);
    }

    const feeSpam = await manager.lateFeeOf(spam.noteId);
    const feeControl = await manager.lateFeeOf(control.noteId);
    expect(feeControl).to.be.greaterThan(100n);
    expect(feeSpam).to.equal(feeControl);
  });

  it("sisa pembulatan terbawa lintas checkpoint dan tidak menambah denda saat DISPUTED", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, debtor, admin } = ctx;
    const note = await f.buildNote(ctx, { principal: IDR(100_000), totalOwed: IDR(100_000) });
    await f.activateOnchain(ctx, note);
    await time.increaseTo(Number(note.dueDate) + 5);
    await manager.accrue(note.noteId);

    await manager.connect(debtor).openDispute(note.noteId, ethers.id("alasan"));
    const during = await manager.lateFeeOf(note.noteId);
    await time.increase(10 * DAY);
    expect(await manager.lateFeeOf(note.noteId)).to.equal(during);
    await manager.connect(admin).closeDispute(note.noteId, ethers.id("selesai"));
    expect(await manager.lateFeeOf(note.noteId)).to.equal(during);
  });
});
