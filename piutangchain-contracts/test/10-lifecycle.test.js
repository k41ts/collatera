const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const f = require("./fixture");
const { ethers, time, E, IDR, DAY, Status, NO_PERMIT } = f;

describe("Alur utama: pencairan ON-CHAIN (escrow) + cicilan on-chain sampai lunas", () => {
  it("escrow → ACTIVE (mint, dana ke debitur) → 3 cicilan → PAID (burn)", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, idrx, debtNote, creditor, debtor, relayer } = ctx;
    const note = await f.buildNote(ctx);
    const sigC = await f.signNote(creditor, ctx, note);
    const sigD = await f.signNote(debtor, ctx, note);
    const permit = await f.signPermit(idrx, creditor, manager.target, note.principal, note.deadline);

    const credBefore = await idrx.balanceOf(creditor.address);
    const debBefore = await idrx.balanceOf(debtor.address);

    // 1) kreditur: tanda tangan + setor dana ke escrow (gas dibayar relayer)
    await expect(manager.connect(relayer).depositEscrow(note, sigC, permit))
      .to.emit(manager, "EscrowDeposited")
      .withArgs(note.noteId, E.noteStructHash(note), creditor.address, note.principal);
    expect(await idrx.balanceOf(manager.target)).to.equal(note.principal);
    expect(await manager.escrowOf(E.noteStructHash(note))).to.equal(note.principal);
    expect(await manager.statusOf(note.noteId)).to.equal(Status.NONE); // belum aktif sebelum debitur tanda tangan

    // 2) debitur tanda tangan → aktivasi atomik
    await expect(manager.connect(relayer).activateOnchain(note, sigC, sigD))
      .to.emit(manager, "NoteActivated")
      .withArgs(
        note.noteId,
        creditor.address,
        debtor.address,
        E.noteStructHash(note),
        note.docHash,
        note.principal,
        note.totalOwed,
        note.dueDate,
        0
      )
      .and.to.emit(manager, "StatusChanged")
      .withArgs(note.noteId, Status.NONE, Status.ACTIVE, relayer.address);

    expect(await debtNote.ownerOf(BigInt(note.noteId))).to.equal(creditor.address);
    expect(await idrx.balanceOf(manager.target)).to.equal(0n);
    expect(await idrx.balanceOf(debtor.address)).to.equal(debBefore + note.principal);
    expect(await idrx.balanceOf(creditor.address)).to.equal(credBefore - note.principal);
    expect(await manager.statusOf(note.noteId)).to.equal(Status.ACTIVE);
    expect(await manager.noteIdOfDocHash(note.docHash)).to.equal(note.noteId);
    expect(await manager.verifyHash(note.noteId, note.docHash)).to.equal(true);
    expect(await manager.verifyHash(note.noteId, ethers.id("dimanipulasi"))).to.equal(false);

    const v = await manager.getNote(note.noteId);
    expect(v.principal).to.equal(note.principal);
    expect(v.totalOwed).to.equal(note.totalOwed);
    expect(v.paid).to.equal(0n);

    // 3) tiga cicilan (debitur membayar via permit; kontrak meneruskan ke kreditur)
    const part = note.totalOwed / 4n;
    const credAfterDisb = await idrx.balanceOf(creditor.address);
    await expect(f.payOnchain(ctx, note.noteId, part, 1))
      .to.emit(manager, "PaymentRecorded")
      .withArgs(note.noteId, part, part, note.totalOwed - part, true, 1, ethers.ZeroHash);
    expect(await idrx.balanceOf(creditor.address)).to.equal(credAfterDisb + part);
    await f.payOnchain(ctx, note.noteId, part, 2);
    expect(await manager.remaining(note.noteId)).to.equal(note.totalOwed - 2n * part);
    expect(await manager.statusOf(note.noteId)).to.equal(Status.ACTIVE);

    const last = await manager.remaining(note.noteId);
    await expect(f.payOnchain(ctx, note.noteId, last, 3))
      .to.emit(manager, "NoteSettled")
      .withArgs(note.noteId, note.totalOwed)
      .and.to.emit(manager, "StatusChanged")
      .withArgs(note.noteId, Status.ACTIVE, Status.PAID, debtor.address);

    expect(await manager.statusOf(note.noteId)).to.equal(Status.PAID);
    expect(await manager.remaining(note.noteId)).to.equal(0n);
    await expect(debtNote.ownerOf(BigInt(note.noteId))).to.be.revertedWithCustomError(debtNote, "NonexistentToken");
    expect(await debtNote.balanceOf(creditor.address)).to.equal(0n);
    // kreditur total menerima totalOwed dan tidak ada dana nyangkut
    expect(await idrx.balanceOf(creditor.address)).to.equal(credBefore - note.principal + note.totalOwed);
    expect(await idrx.balanceOf(manager.target)).to.equal(0n);
    // hash dokumen tetap terkunci walau token sudah di-burn
    expect(await manager.noteIdOfDocHash(note.docHash)).to.equal(note.noteId);
  });

  it("pembayaran on-chain memakai allowance yang sudah ada (tanpa permit)", async () => {
    const ctx = await loadFixture(f.deployAll);
    const note = await f.buildNote(ctx);
    await f.activateOnchain(ctx, note);
    await ctx.idrx.connect(ctx.debtor).approve(ctx.manager.target, IDR(100));
    await ctx.manager.connect(ctx.debtor).payOnchain(note.noteId, IDR(100), 1, NO_PERMIT);
    expect((await ctx.manager.getNote(note.noteId)).paid).to.equal(IDR(100));
  });

  it("permit yang di-front-run (nonce sudah terpakai) tidak menggagalkan pembayaran", async () => {
    const ctx = await loadFixture(f.deployAll);
    const note = await f.buildNote(ctx);
    await f.activateOnchain(ctx, note);
    const amount = IDR(250);
    const permit = await f.signPermit(ctx.idrx, ctx.debtor, ctx.manager.target, amount, (await time.latest()) + DAY);
    // penyerang mengonsumsi permit lebih dulu
    await ctx.idrx.connect(ctx.stranger).permit(ctx.debtor.address, ctx.manager.target, amount, permit.deadline, permit.v, permit.r, permit.s);
    await ctx.manager.connect(ctx.debtor).payOnchain(note.noteId, amount, 1, permit);
    expect((await ctx.manager.getNote(note.noteId)).paid).to.equal(amount);
  });

  it("gasless penuh: debitur membayar lewat forwarder (relayer bayar gas)", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, forwarder, debtor, relayer, idrx } = ctx;
    const note = await f.buildNote(ctx);
    await f.activateOnchain(ctx, note);
    const amount = IDR(300_000);
    const permit = await f.signPermit(idrx, debtor, manager.target, amount, (await time.latest()) + DAY);
    const data = manager.interface.encodeFunctionData("payOnchain", [note.noteId, amount, 1, permit]);
    const req = {
      from: debtor.address,
      to: manager.target,
      gas: 800_000n,
      nonce: await forwarder.nonces(debtor.address),
      deadline: (await time.latest()) + DAY,
      data,
    };
    const sig = await debtor.signTypedData(E.forwarderDomain(ctx.chainId, forwarder.target), E.FORWARD_TYPES, req);
    const ethBefore = await ethers.provider.getBalance(debtor.address);
    await forwarder.connect(relayer).execute(req, sig);
    expect(await ethers.provider.getBalance(debtor.address)).to.equal(ethBefore); // debitur tidak keluar gas
    expect((await manager.getNote(note.noteId)).paid).to.equal(amount);
  });
});

describe("Alur: pencairan OFF-CHAIN + pembayaran off-chain (konfirmasi kreditur)", () => {
  it("receipt debitur → ACTIVE (mint) → pembayaran bertanda tangan kreditur → PAID (burn)", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, debtNote, idrx, creditor, debtor, relayer } = ctx;
    const note = await f.buildNote(ctx, { disbursement: 1 });
    const balances = [await idrx.balanceOf(creditor.address), await idrx.balanceOf(debtor.address)];

    await f.activateOffchain(ctx, note);
    expect(await manager.statusOf(note.noteId)).to.equal(Status.ACTIVE);
    expect(await debtNote.ownerOf(BigInt(note.noteId))).to.equal(creditor.address);
    // tidak ada dana stablecoin yang bergerak
    expect(await idrx.balanceOf(creditor.address)).to.equal(balances[0]);
    expect(await idrx.balanceOf(debtor.address)).to.equal(balances[1]);

    const half = note.totalOwed / 2n;
    const { c, sig } = await f.signPayment(ctx, note.noteId, half, { installmentIndex: 1 });
    await expect(manager.connect(relayer).recordOffchainPayment(c, sig))
      .to.emit(manager, "PaymentRecorded")
      .withArgs(note.noteId, half, half, note.totalOwed - half, false, 1, c.proofHash);
    expect(await manager.statusOf(note.noteId)).to.equal(Status.ACTIVE);

    await expect(f.payOffchain(ctx, note.noteId, note.totalOwed - half, { installmentIndex: 2 })).to.emit(manager, "NoteSettled");
    expect(await manager.statusOf(note.noteId)).to.equal(Status.PAID);
    await expect(debtNote.ownerOf(BigInt(note.noteId))).to.be.revertedWithCustomError(debtNote, "NonexistentToken");
  });

  it("pembayaran campuran: cicilan 1 off-chain, cicilan 2 on-chain", async () => {
    const ctx = await loadFixture(f.deployAll);
    const note = await f.buildNote(ctx, { disbursement: 1 });
    await f.activateOffchain(ctx, note);
    await f.payOffchain(ctx, note.noteId, IDR(600_000), { installmentIndex: 1 });
    await f.payOnchain(ctx, note.noteId, note.totalOwed - IDR(600_000), 2);
    expect(await ctx.manager.statusOf(note.noteId)).to.equal(Status.PAID);
  });

  it("kreditur menandai lunas (mengikhlaskan sisa) → PAID + burn", async () => {
    const ctx = await loadFixture(f.deployAll);
    const note = await f.buildNote(ctx, { disbursement: 1 });
    await f.activateOffchain(ctx, note);
    await f.payOffchain(ctx, note.noteId, IDR(900_000));
    await expect(ctx.manager.connect(ctx.creditor).markPaid(note.noteId))
      .to.emit(ctx.manager, "NoteMarkedPaid")
      .withArgs(note.noteId, ctx.creditor.address, note.totalOwed - IDR(900_000));
    expect(await ctx.manager.statusOf(note.noteId)).to.equal(Status.PAID);
    await expect(ctx.debtNote.ownerOf(BigInt(note.noteId))).to.be.revertedWithCustomError(ctx.debtNote, "NonexistentToken");
  });
});

describe("Jatuh tempo, OVERDUE, dan denda", () => {
  it("OVERDUE otomatis setelah jatuh tempo; denda flat sekali ikut wajib dibayar", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager } = ctx;
    const note = await f.buildNote(ctx);
    await f.activateOnchain(ctx, note);
    expect(await manager.requiredAmount(note.noteId)).to.equal(note.totalOwed);

    await time.increaseTo(note.dueDate); // tepat jatuh tempo: belum OVERDUE
    expect(await manager.statusOf(note.noteId)).to.equal(Status.ACTIVE);
    await time.increaseTo(note.dueDate + 1);
    expect(await manager.statusOf(note.noteId)).to.equal(Status.OVERDUE);
    expect(await manager.requiredAmount(note.noteId)).to.equal(note.totalOwed + note.lateFee);
    expect((await manager.getNote(note.noteId)).status).to.equal(Status.OVERDUE);

    // bayar totalOwed saja → belum lunas karena denda
    await f.payOnchain(ctx, note.noteId, note.totalOwed);
    expect(await manager.statusOf(note.noteId)).to.equal(Status.OVERDUE);
    expect(await manager.remaining(note.noteId)).to.equal(note.lateFee);
    // denda tidak bertambah lagi seiring waktu
    await time.increase(100 * DAY);
    expect(await manager.remaining(note.noteId)).to.equal(note.lateFee);

    await f.payOnchain(ctx, note.noteId, note.lateFee);
    expect(await manager.statusOf(note.noteId)).to.equal(Status.PAID);
  });

  it("piutang tanpa denda (lateFee = 0) tidak menambah kewajiban saat OVERDUE", async () => {
    const ctx = await loadFixture(f.deployAll);
    const note = await f.buildNote(ctx, { lateFee: 0n });
    await f.activateOnchain(ctx, note);
    await time.increaseTo(note.dueDate + 5 * DAY);
    expect(await ctx.manager.requiredAmount(note.noteId)).to.equal(note.totalOwed);
    await f.payOnchain(ctx, note.noteId, note.totalOwed);
    expect(await ctx.manager.statusOf(note.noteId)).to.equal(Status.PAID);
  });

  it("lunas saat OVERDUE → PAID", async () => {
    const ctx = await loadFixture(f.deployAll);
    const note = await f.buildNote(ctx, { lateFee: 0n });
    await f.activateOnchain(ctx, note);
    await time.increaseTo(note.dueDate + 1);
    expect(await ctx.manager.statusOf(note.noteId)).to.equal(Status.OVERDUE);
    await f.payOnchain(ctx, note.noteId, note.totalOwed);
    expect(await ctx.manager.statusOf(note.noteId)).to.equal(Status.PAID);
  });
});
