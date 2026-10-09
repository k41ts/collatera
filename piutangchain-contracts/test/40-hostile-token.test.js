const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const f = require("./fixture");
const { ethers, E, IDR, Status, NO_PERMIT } = f;

// DebtManager yang memakai stablecoin "nakal" (fee-on-transfer, return false, tanpa return value, re-entrancy)
async function deployHostile() {
  const base = await f.deployAll();
  const token = await ethers.deployContract("MockHostileToken");
  const note = await ethers.deployContract("DebtNote");
  const manager = await ethers.deployContract("DebtManager", [
    note.target,
    token.target,
    base.forwarder.target,
    base.admin.address,
  ]);
  await note.setManager(manager.target);
  await token.mint(base.creditor.address, IDR(100_000_000));
  await token.mint(base.debtor.address, IDR(100_000_000));
  await token.connect(base.creditor).approve(manager.target, ethers.MaxUint256);
  await token.connect(base.debtor).approve(manager.target, ethers.MaxUint256);
  const domain = E.managerDomain(base.chainId, manager.target);
  return { ...base, token, debtNote: note, manager, domain, idrx: token };
}

const Mode = { NORMAL: 0, FEE: 1, RETURN_FALSE: 2, NO_RETURN: 3, REENTER: 4 };

describe("Stablecoin tidak standar", () => {
  it("token tanpa return value (gaya USDT) tetap berjalan penuh", async () => {
    const ctx = await loadFixture(deployHostile);
    await ctx.token.setMode(Mode.NO_RETURN);
    const note = await f.buildNote(ctx);
    const sigC = await f.signNote(ctx.creditor, ctx, note);
    const sigD = await f.signNote(ctx.debtor, ctx, note);
    await ctx.manager.depositEscrow(note, sigC, NO_PERMIT);
    await ctx.manager.activateOnchain(note, f.scheduleOf(note), sigC, sigD);
    await ctx.manager.connect(ctx.debtor).payOnchain(note.noteId, note.totalOwed, 1, NO_PERMIT);
    expect(await ctx.manager.statusOf(note.noteId)).to.equal(Status.PAID);
  });

  it("token yang mengembalikan false → TransferFailed (tidak dianggap sukses)", async () => {
    const ctx = await loadFixture(deployHostile);
    await ctx.token.setMode(Mode.RETURN_FALSE);
    const note = await f.buildNote(ctx);
    const sigC = await f.signNote(ctx.creditor, ctx, note);
    await expect(ctx.manager.depositEscrow(note, sigC, NO_PERMIT)).to.be.revertedWithCustomError(ctx.manager, "TransferFailed");
  });

  it("token fee-on-transfer ditolak (dana yang diterima harus persis sama) di escrow dan pembayaran", async () => {
    const ctx = await loadFixture(deployHostile);
    const note = await f.buildNote(ctx);
    const sigC = await f.signNote(ctx.creditor, ctx, note);
    const sigD = await f.signNote(ctx.debtor, ctx, note);
    await ctx.token.setMode(Mode.FEE);
    await expect(ctx.manager.depositEscrow(note, sigC, NO_PERMIT)).to.be.revertedWithCustomError(ctx.manager, "UnexpectedTransferAmount");

    await ctx.token.setMode(Mode.NORMAL);
    await ctx.manager.depositEscrow(note, sigC, NO_PERMIT);
    await ctx.manager.activateOnchain(note, f.scheduleOf(note), sigC, sigD);
    await ctx.token.setMode(Mode.FEE);
    await expect(ctx.manager.connect(ctx.debtor).payOnchain(note.noteId, IDR(1000), 1, NO_PERMIT)).to.be.revertedWithCustomError(
      ctx.manager,
      "UnexpectedTransferAmount"
    );
    expect((await ctx.manager.getNote(note.noteId)).paid).to.equal(0n); // seluruh transaksi di-rollback
  });

  it("re-entrancy dari token saat pembayaran diblok oleh nonReentrant", async () => {
    const ctx = await loadFixture(deployHostile);
    const note = await f.buildNote(ctx);
    const sigC = await f.signNote(ctx.creditor, ctx, note);
    const sigD = await f.signNote(ctx.debtor, ctx, note);
    await ctx.manager.depositEscrow(note, sigC, NO_PERMIT);
    await ctx.manager.activateOnchain(note, f.scheduleOf(note), sigC, sigD);

    // saat transferFrom, token mencoba memanggil balik fungsi nonReentrant milik manager
    const reenter = ctx.manager.interface.encodeFunctionData("markPaid", [note.noteId]);
    await ctx.token.setReenter(ctx.manager.target, reenter);
    await ctx.token.setMode(Mode.REENTER);
    await ctx.manager.connect(ctx.debtor).payOnchain(note.noteId, IDR(1000), 1, NO_PERMIT);

    expect(await ctx.token.reenterSucceeded()).to.equal(false);
    const selector = ctx.manager.interface.getError("ReentrantCall").selector;
    expect(await ctx.token.reenterReturn()).to.equal(selector);
    expect(await ctx.manager.statusOf(note.noteId)).to.equal(Status.ACTIVE); // piutang tidak dilunasi lewat re-entrancy
  });
});

describe("tokenURI mengikuti status", () => {
  it("DISPUTED dan FROZEN tercermin di metadata", async () => {
    const ctx = await loadFixture(f.deployAll);
    const note = await f.buildNote(ctx);
    await f.activateOnchain(ctx, note);
    const status = async () =>
      JSON.parse((await ctx.debtNote.tokenURI(BigInt(note.noteId))).slice(27)).attributes.find((a) => a.trait_type === "status").value;
    await ctx.manager.connect(ctx.debtor).openDispute(note.noteId, ethers.id("a"));
    expect(await status()).to.equal("DISPUTED");
    await ctx.manager.connect(ctx.freezer).freeze(note.noteId, ethers.id("b"));
    expect(await status()).to.equal("FROZEN");
  });
});
