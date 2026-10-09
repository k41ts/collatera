const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const f = require("./fixture");
const { ethers, time, E, IDR, DAY, Status, NO_PERMIT, ADMIN_ROLE, FREEZER_ROLE } = f;

describe("Validasi aktivasi & replay protection", () => {
  it("satu dokumen (docHash sama) tidak bisa menjadi dua token", async () => {
    const ctx = await loadFixture(f.deployAll);
    const a = await f.buildNote(ctx);
    await f.activateOnchain(ctx, a);
    const b = await f.buildNote(ctx, { docHash: a.docHash });
    const sigC = await f.signNote(ctx.creditor, ctx, b);
    const permit = await f.signPermit(ctx.idrx, ctx.creditor, ctx.manager.target, b.principal, b.deadline);
    await expect(ctx.manager.depositEscrow(b, sigC, permit)).to.be.revertedWithCustomError(ctx.manager, "DocHashAlreadyUsed");
    const c = await f.buildNote(ctx, { docHash: a.docHash, disbursement: 1 });
    await expect(f.activateOffchain(ctx, c)).to.be.revertedWithCustomError(ctx.manager, "DocHashAlreadyUsed");
  });

  it("noteId yang sama tidak bisa diaktifkan dua kali", async () => {
    const ctx = await loadFixture(f.deployAll);
    const a = await f.buildNote(ctx);
    await f.activateOnchain(ctx, a);
    const again = await f.buildNote(ctx, { noteId: a.noteId });
    await expect(f.activateOnchain(ctx, again)).to.be.revertedWithCustomError(ctx.manager, "NoteAlreadyExists");
  });

  it("signature yang sama tidak bisa dipakai ulang (nonce) dan tidak bisa untuk Note lain", async () => {
    const ctx = await loadFixture(f.deployAll);
    const a = await f.buildNote(ctx);
    const { sigC, sigD } = await f.activateOnchain(ctx, a);
    // note baru dengan nonce yang sama persis → NonceAlreadyUsed (escrow disetor ulang dengan signature baru)
    const b = await f.buildNote(ctx, { creditorNonce: a.creditorNonce, debtorNonce: a.debtorNonce });
    const sC = await f.signNote(ctx.creditor, ctx, b);
    const sD = await f.signNote(ctx.debtor, ctx, b);
    const permit = await f.signPermit(ctx.idrx, ctx.creditor, ctx.manager.target, b.principal, b.deadline);
    await expect(ctx.manager.depositEscrow(b, sC, permit)).to.be.revertedWithCustomError(ctx.manager, "NonceAlreadyUsed");
    // signature milik note a tidak berlaku untuk note b
    await expect(ctx.manager.activateOnchain(b, f.scheduleOf(b), sigC, sigD)).to.be.reverted;
    void sD;
  });

  it("signature debitur dari akun lain / data diubah ditolak", async () => {
    const ctx = await loadFixture(f.deployAll);
    const note = await f.buildNote(ctx);
    const sigC = await f.signNote(ctx.creditor, ctx, note);
    const fake = await f.signNote(ctx.stranger, ctx, note);
    const permit = await f.signPermit(ctx.idrx, ctx.creditor, ctx.manager.target, note.principal, note.deadline);
    await ctx.manager.depositEscrow(note, sigC, permit);
    await expect(ctx.manager.activateOnchain(note, f.scheduleOf(note), sigC, fake))
      .to.be.revertedWithCustomError(ctx.manager, "InvalidSignature")
      .withArgs(ctx.debtor.address);

    // nominal diubah setelah ditandatangani → hash beda → escrow tidak ditemukan
    const sigD = await f.signNote(ctx.debtor, ctx, note);
    const tampered = { ...note, totalOwed: note.totalOwed - 1n };
    await expect(ctx.manager.activateOnchain(tampered, f.scheduleOf(tampered), sigC, sigD)).to.be.revertedWithCustomError(ctx.manager, "EscrowMissing");
    // signature sampah (panjang salah)
    await expect(ctx.manager.activateOnchain(note, f.scheduleOf(note), "0x1234", sigD))
      .to.be.revertedWithCustomError(ctx.manager, "InvalidSignature")
      .withArgs(ctx.creditor.address);
  });

  it("signature kedaluwarsa dan domain chain/kontrak lain ditolak", async () => {
    const ctx = await loadFixture(f.deployAll);
    const note = await f.buildNote(ctx);
    const sigC = await f.signNote(ctx.creditor, ctx, note);
    const permit = await f.signPermit(ctx.idrx, ctx.creditor, ctx.manager.target, note.principal, note.deadline);
    // signature dari domain lain (chainId beda)
    const wrongDomain = { ...ctx.domain, chainId: 1n };
    const wrongSig = await ctx.creditor.signTypedData(wrongDomain, E.NOTE_TYPES, note);
    await expect(ctx.manager.depositEscrow(note, wrongSig, permit)).to.be.revertedWithCustomError(ctx.manager, "InvalidSignature");

    await time.increaseTo(note.deadline + 1);
    await expect(ctx.manager.depositEscrow(note, sigC, permit)).to.be.revertedWithCustomError(ctx.manager, "SignatureExpired");
  });

  it("validasi field: pihak sama, nominal 0, total < pokok, jatuh tempo lampau, disbursement salah, id/hash nol", async () => {
    const ctx = await loadFixture(f.deployAll);
    const m = ctx.manager;
    const tryNote = async (over, err) => {
      const n = await f.buildNote(ctx, over);
      const sigC = await f.signNote(ctx.creditor, ctx, n);
      await expect(m.depositEscrow(n, sigC, NO_PERMIT)).to.be.revertedWithCustomError(m, err);
    };
    await tryNote({ debtor: ctx.creditor.address }, "InvalidParties");
    await tryNote({ debtor: ethers.ZeroAddress }, "InvalidParties");
    await tryNote({ creditor: ethers.ZeroAddress }, "InvalidParties");
    await tryNote({ principal: 0n }, "InvalidAmount");
    await tryNote({ totalOwed: IDR(1) }, "InvalidAmount");
    await tryNote({ noteId: ethers.ZeroHash }, "InvalidAmount");
    await tryNote({ docHash: ethers.ZeroHash }, "InvalidAmount");
    await tryNote({ version: 0 }, "InvalidAmount");
    await tryNote({ dueDate: (await time.latest()) - 1 }, "InvalidDueDate");
    await tryNote({ disbursement: 2 }, "WrongDisbursement");
  });

  it("jalur yang salah: depositEscrow untuk note off-chain, activateOnchain/Offchain tertukar", async () => {
    const ctx = await loadFixture(f.deployAll);
    const m = ctx.manager;
    const off = await f.buildNote(ctx, { disbursement: 1 });
    const sigC = await f.signNote(ctx.creditor, ctx, off);
    const sigD = await f.signNote(ctx.debtor, ctx, off);
    await expect(m.depositEscrow(off, sigC, NO_PERMIT)).to.be.revertedWithCustomError(m, "WrongDisbursement");
    await expect(m.activateOnchain(off, f.scheduleOf(off), sigC, sigD)).to.be.revertedWithCustomError(m, "WrongDisbursement");
    const on = await f.buildNote(ctx);
    const { receipt, sig } = await f.signReceipt(ctx, on);
    await expect(m.activateOffchain(on, f.scheduleOf(on), sigC, sigD, receipt, sig)).to.be.revertedWithCustomError(m, "WrongDisbursement");
  });

  it("aktivasi on-chain tanpa escrow ditolak (token tidak pernah ter-mint tanpa dana)", async () => {
    const ctx = await loadFixture(f.deployAll);
    const note = await f.buildNote(ctx);
    const sigC = await f.signNote(ctx.creditor, ctx, note);
    const sigD = await f.signNote(ctx.debtor, ctx, note);
    await expect(ctx.manager.activateOnchain(note, f.scheduleOf(note), sigC, sigD)).to.be.revertedWithCustomError(ctx.manager, "EscrowMissing");
  });

  it("aktivasi off-chain: receipt harus cocok, belum kedaluwarsa, ditandatangani debitur, nonce sekali pakai", async () => {
    const ctx = await loadFixture(f.deployAll);
    const m = ctx.manager;
    const note = await f.buildNote(ctx, { disbursement: 1 });
    const sigC = await f.signNote(ctx.creditor, ctx, note);
    const sigD = await f.signNote(ctx.debtor, ctx, note);

    const wrongHash = await f.signReceipt(ctx, note, { noteHash: ethers.id("lain") });
    await expect(m.activateOffchain(note, f.scheduleOf(note), sigC, sigD, wrongHash.receipt, wrongHash.sig)).to.be.revertedWithCustomError(m, "ReceiptMismatch");
    const wrongAmt = await f.signReceipt(ctx, note, { amount: note.principal - 1n });
    await expect(m.activateOffchain(note, f.scheduleOf(note), sigC, sigD, wrongAmt.receipt, wrongAmt.sig)).to.be.revertedWithCustomError(m, "ReceiptMismatch");

    const expired = await f.signReceipt(ctx, note, { deadline: (await time.latest()) - 1 });
    await expect(m.activateOffchain(note, f.scheduleOf(note), sigC, sigD, expired.receipt, expired.sig)).to.be.revertedWithCustomError(m, "SignatureExpired");

    // receipt ditandatangani kreditur (bukan debitur) → ditolak
    const ok = await f.signReceipt(ctx, note);
    const forged = await ctx.creditor.signTypedData(ctx.domain, E.RECEIPT_TYPES, ok.receipt);
    await expect(m.activateOffchain(note, f.scheduleOf(note), sigC, sigD, ok.receipt, forged))
      .to.be.revertedWithCustomError(m, "InvalidSignature")
      .withArgs(ctx.debtor.address);

    await m.activateOffchain(note, f.scheduleOf(note), sigC, sigD, ok.receipt, ok.sig);
    expect(await m.statusOf(note.noteId)).to.equal(Status.ACTIVE);
  });

  it("cancelNonce: kreditur bisa menarik tanda tangan sebelum aktivasi", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager } = ctx;
    const note = await f.buildNote(ctx);
    const sigC = await f.signNote(ctx.creditor, ctx, note);
    const sigD = await f.signNote(ctx.debtor, ctx, note);
    const permit = await f.signPermit(ctx.idrx, ctx.creditor, manager.target, note.principal, note.deadline);
    await manager.depositEscrow(note, sigC, permit);

    await expect(manager.connect(ctx.creditor).cancelNonce(note.creditorNonce))
      .to.emit(manager, "NonceCancelled")
      .withArgs(ctx.creditor.address, note.creditorNonce);
    await expect(manager.activateOnchain(note, f.scheduleOf(note), sigC, sigD)).to.be.revertedWithCustomError(manager, "NonceAlreadyUsed");
    await expect(manager.connect(ctx.creditor).cancelNonce(note.creditorNonce)).to.be.revertedWithCustomError(manager, "NonceAlreadyUsed");
    // dana tetap bisa ditarik
    await expect(manager.connect(ctx.creditor).refundEscrow(note)).to.emit(manager, "EscrowRefunded");
  });
});

describe("Escrow", () => {
  it("refund oleh kreditur; bukan kreditur ditolak; tidak bisa dua kali; deposit ganda ditolak", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, idrx, creditor, stranger } = ctx;
    const note = await f.buildNote(ctx);
    const sigC = await f.signNote(creditor, ctx, note);
    const permit = await f.signPermit(idrx, creditor, manager.target, note.principal, note.deadline);
    const before = await idrx.balanceOf(creditor.address);
    await manager.depositEscrow(note, sigC, permit);
    await expect(manager.depositEscrow(note, sigC, NO_PERMIT)).to.be.revertedWithCustomError(manager, "EscrowAlreadyDeposited");

    await expect(manager.connect(stranger).refundEscrow(note)).to.be.revertedWithCustomError(manager, "NotCreditor");
    await manager.connect(creditor).refundEscrow(note);
    expect(await idrx.balanceOf(creditor.address)).to.equal(before);
    await expect(manager.connect(creditor).refundEscrow(note)).to.be.revertedWithCustomError(manager, "EscrowMissing");
  });

  it("deposit tanpa permit/allowance gagal; deposit oleh pihak lain tanpa signature kreditur gagal", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, idrx, creditor, stranger } = ctx;
    const note = await f.buildNote(ctx);
    const sigC = await f.signNote(creditor, ctx, note);
    await expect(manager.depositEscrow(note, sigC, NO_PERMIT)).to.be.revertedWithCustomError(manager, "TransferFailed");
    const forged = await f.signNote(stranger, ctx, note);
    await expect(manager.depositEscrow(note, forged, NO_PERMIT))
      .to.be.revertedWithCustomError(manager, "InvalidSignature")
      .withArgs(creditor.address);
  });

  it("dana yang tertahan tidak bisa dikuras: refund kedua setelah aktivasi gagal", async () => {
    const ctx = await loadFixture(f.deployAll);
    const note = await f.buildNote(ctx);
    await f.activateOnchain(ctx, note);
    await expect(ctx.manager.connect(ctx.creditor).refundEscrow(note)).to.be.revertedWithCustomError(ctx.manager, "EscrowMissing");
  });
});

describe("Pembayaran: batas dan otorisasi", () => {
  it("overpayment, nol, bukan debitur, sudah lunas, dan piutang tidak ada ditolak", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, debtor, creditor, stranger } = ctx;
    const note = await f.buildNote(ctx);
    await f.activateOnchain(ctx, note);

    await ctx.idrx.connect(debtor).approve(manager.target, ethers.MaxUint256);
    await expect(manager.connect(debtor).payOnchain(note.noteId, 0, 1, NO_PERMIT)).to.be.revertedWithCustomError(manager, "InvalidAmount");
    await expect(manager.connect(creditor).payOnchain(note.noteId, 1, 1, NO_PERMIT)).to.be.revertedWithCustomError(manager, "NotDebtor");
    await expect(manager.connect(stranger).payOnchain(note.noteId, 1, 1, NO_PERMIT)).to.be.revertedWithCustomError(manager, "NotDebtor");
    await expect(manager.connect(debtor).payOnchain(ethers.id("tidak-ada"), 1, 1, NO_PERMIT)).to.be.revertedWithCustomError(manager, "NoteNotFound");

    // kelebihan on-chain tidak ditarik: yang dibayar hanya sisa utang
    const before = await ctx.idrx.balanceOf(debtor.address);
    await expect(manager.connect(debtor).payOnchain(note.noteId, note.totalOwed + IDR(5_000), 1, NO_PERMIT))
      .to.emit(manager, "PaymentRecorded")
      .withArgs(note.noteId, note.totalOwed, note.totalOwed, 0n, true, 1, ethers.ZeroHash, 0n);
    expect(await ctx.idrx.balanceOf(debtor.address)).to.equal(before - note.totalOwed);
    await expect(manager.connect(debtor).payOnchain(note.noteId, 1, 1, NO_PERMIT))
      .to.be.revertedWithCustomError(manager, "InvalidStatus")
      .withArgs(Status.PAID);
    await expect(manager.getNote(ethers.id("tidak-ada"))).to.be.revertedWithCustomError(manager, "NoteNotFound");
    await expect(manager.requiredAmount(ethers.id("tidak-ada"))).to.be.revertedWithCustomError(manager, "NoteNotFound");
    expect(await manager.statusOf(ethers.id("tidak-ada"))).to.equal(Status.NONE);
    expect(await manager.verifyHash(ethers.id("tidak-ada"), ethers.ZeroHash)).to.equal(false);
  });

  it("konfirmasi off-chain: bukan signature kreditur, replay nonce, bukti ganda, kedaluwarsa, overpayment", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, debtor, relayer } = ctx;
    const note = await f.buildNote(ctx, { disbursement: 1 });
    await f.activateOffchain(ctx, note);

    // ditandatangani debitur (bukan kreditur)
    const mine = await f.signPayment(ctx, note.noteId, IDR(1000));
    const forged = await debtor.signTypedData(ctx.domain, E.PAYMENT_TYPES, mine.c);
    await expect(manager.connect(relayer).recordOffchainPayment(mine.c, forged))
      .to.be.revertedWithCustomError(manager, "InvalidSignature")
      .withArgs(ctx.creditor.address);

    // data diubah setelah ditandatangani
    await expect(manager.recordOffchainPayment({ ...mine.c, amount: IDR(2000) }, mine.sig)).to.be.revertedWithCustomError(
      manager,
      "InvalidSignature"
    );

    await manager.recordOffchainPayment(mine.c, mine.sig);
    // replay persis sama → bukti sudah dipakai (idempotent)
    await expect(manager.recordOffchainPayment(mine.c, mine.sig)).to.be.revertedWithCustomError(manager, "ProofAlreadyUsed");
    // bukti sama, nonce baru → tetap ditolak
    const dupProof = await f.signPayment(ctx, note.noteId, IDR(1000), { proofHash: mine.c.proofHash });
    await expect(manager.recordOffchainPayment(dupProof.c, dupProof.sig)).to.be.revertedWithCustomError(manager, "ProofAlreadyUsed");
    // bukti baru, nonce lama → NonceAlreadyUsed
    const dupNonce = await f.signPayment(ctx, note.noteId, IDR(1000), { nonce: mine.c.nonce });
    await expect(manager.recordOffchainPayment(dupNonce.c, dupNonce.sig)).to.be.revertedWithCustomError(manager, "NonceAlreadyUsed");
    // proofHash nol
    const zero = await f.signPayment(ctx, note.noteId, IDR(1000), { proofHash: ethers.ZeroHash });
    await expect(manager.recordOffchainPayment(zero.c, zero.sig)).to.be.revertedWithCustomError(manager, "ProofAlreadyUsed");
    // kedaluwarsa
    const old = await f.signPayment(ctx, note.noteId, IDR(1000), { deadline: (await time.latest()) - 1 });
    await expect(manager.recordOffchainPayment(old.c, old.sig)).to.be.revertedWithCustomError(manager, "SignatureExpired");
    // lebih dari sisa
    const over = await f.signPayment(ctx, note.noteId, note.totalOwed);
    await expect(manager.recordOffchainPayment(over.c, over.sig)).to.be.revertedWithCustomError(manager, "Overpayment");
    // piutang tidak ada
    const nf = await f.signPayment(ctx, ethers.id("tidak-ada"), IDR(1));
    await expect(manager.recordOffchainPayment(nf.c, nf.sig)).to.be.revertedWithCustomError(manager, "NoteNotFound");
  });

  it("markPaid hanya kreditur", async () => {
    const ctx = await loadFixture(f.deployAll);
    const note = await f.buildNote(ctx);
    await f.activateOnchain(ctx, note);
    await expect(ctx.manager.connect(ctx.debtor).markPaid(note.noteId)).to.be.revertedWithCustomError(ctx.manager, "NotCreditor");
    await expect(ctx.manager.connect(ctx.stranger).markPaid(note.noteId)).to.be.revertedWithCustomError(ctx.manager, "NotCreditor");
  });
});

describe("Smart account (ERC-1271)", () => {
  it("kreditur dan debitur berupa smart wallet bisa menandatangani; signature pemilik lain ditolak", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, idrx, creditor, debtor, relayer, stranger } = ctx;
    const credWallet = await ethers.deployContract("MockERC1271Wallet", [creditor.address]);
    const debWallet = await ethers.deployContract("MockERC1271Wallet", [debtor.address]);
    await idrx.mint(credWallet.target, IDR(10_000_000));

    const note = await f.buildNote(ctx, {
      creditor: credWallet.target,
      debtor: debWallet.target,
      disbursement: 1,
    });
    const sigC = await creditor.signTypedData(ctx.domain, E.NOTE_TYPES, note);
    const sigD = await debtor.signTypedData(ctx.domain, E.NOTE_TYPES, note);
    const receipt = {
      noteHash: E.noteStructHash(note),
      proofHash: ethers.id("bukti"),
      amount: note.principal,
      nonce: 1n,
      deadline: note.deadline,
    };
    const sigR = await debtor.signTypedData(ctx.domain, E.RECEIPT_TYPES, receipt);

    const strangerSig = await stranger.signTypedData(ctx.domain, E.NOTE_TYPES, note);
    await expect(manager.connect(relayer).activateOffchain(note, f.scheduleOf(note), strangerSig, sigD, receipt, sigR))
      .to.be.revertedWithCustomError(manager, "InvalidSignature")
      .withArgs(credWallet.target);

    await manager.connect(relayer).activateOffchain(note, f.scheduleOf(note), sigC, sigD, receipt, sigR);
    expect(await ctx.debtNote.ownerOf(BigInt(note.noteId))).to.equal(credWallet.target);
    expect(await manager.statusOf(note.noteId)).to.equal(Status.ACTIVE);
  });
});

describe("Pause, role, dan konstruktor", () => {
  it("pause menahan deposit/aktivasi/pembayaran/revisi; refund & dispute & freeze tetap jalan", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { manager, admin, creditor, debtor, freezer, stranger } = ctx;
    const live = await f.buildNote(ctx);
    await f.activateOnchain(ctx, live);
    const pending = await f.buildNote(ctx);
    const sigC = await f.signNote(creditor, ctx, pending);
    const permit = await f.signPermit(ctx.idrx, creditor, manager.target, pending.principal, pending.deadline);
    await manager.depositEscrow(pending, sigC, permit);

    await expect(manager.connect(stranger).pause()).to.be.revertedWithCustomError(manager, "AccessControlUnauthorizedAccount");
    await expect(manager.connect(admin).pause()).to.emit(manager, "Paused").withArgs(admin.address);
    expect(await manager.paused()).to.equal(true);
    await expect(manager.connect(admin).pause()).to.be.revertedWithCustomError(manager, "EnforcedPause");

    const n2 = await f.buildNote(ctx);
    const s2 = await f.signNote(creditor, ctx, n2);
    await expect(manager.depositEscrow(n2, s2, NO_PERMIT)).to.be.revertedWithCustomError(manager, "EnforcedPause");
    await expect(manager.connect(debtor).payOnchain(live.noteId, 1, 1, NO_PERMIT)).to.be.revertedWithCustomError(manager, "EnforcedPause");
    await expect(manager.connect(creditor).markPaid(live.noteId)).to.be.revertedWithCustomError(manager, "EnforcedPause");

    // jalan keluar tetap terbuka
    await manager.connect(creditor).refundEscrow(pending);
    await manager.connect(debtor).openDispute(live.noteId, ethers.id("alasan"));
    await manager.connect(freezer).freeze(live.noteId, ethers.id("tamper"));

    await expect(manager.connect(admin).unpause()).to.emit(manager, "Unpaused").withArgs(admin.address);
    await expect(manager.connect(admin).unpause()).to.be.revertedWithCustomError(manager, "ExpectedPause");
  });

  it("hanya DEFAULT_ADMIN yang mengelola role; renounce butuh konfirmasi", async () => {
    const { manager, admin, stranger, freezer } = await loadFixture(f.deployAll);
    await expect(manager.connect(stranger).grantRole(ADMIN_ROLE, stranger.address)).to.be.revertedWithCustomError(
      manager,
      "AccessControlUnauthorizedAccount"
    );
    await expect(manager.connect(admin).grantRole(ADMIN_ROLE, stranger.address)).to.emit(manager, "RoleGranted");
    expect(await manager.hasRole(ADMIN_ROLE, stranger.address)).to.equal(true);
    await manager.connect(admin).grantRole(ADMIN_ROLE, stranger.address); // idempotent
    // ADMIN_ROLE bukan pengelola role
    await expect(manager.connect(stranger).revokeRole(FREEZER_ROLE, freezer.address)).to.be.revertedWithCustomError(
      manager,
      "AccessControlUnauthorizedAccount"
    );
    await expect(manager.connect(admin).revokeRole(ADMIN_ROLE, stranger.address)).to.emit(manager, "RoleRevoked");
    await manager.connect(admin).revokeRole(ADMIN_ROLE, stranger.address); // idempotent
    await expect(manager.connect(freezer).renounceRole(FREEZER_ROLE, admin.address)).to.be.revertedWithCustomError(
      manager,
      "AccessControlBadConfirmation"
    );
    await manager.connect(freezer).renounceRole(FREEZER_ROLE, freezer.address);
    expect(await manager.hasRole(FREEZER_ROLE, freezer.address)).to.equal(false);
  });

  it("konstruktor menolak alamat nol; trusted forwarder terkonfigurasi", async () => {
    const ctx = await loadFixture(f.deployAll);
    const args = [ctx.debtNote.target, ctx.idrx.target, ctx.forwarder.target, ctx.admin.address];
    for (const i of [0, 1, 3]) {
      const bad = [...args];
      bad[i] = ethers.ZeroAddress;
      await expect(ethers.deployContract("DebtManager", bad)).to.be.revertedWithCustomError(ctx.manager, "ZeroAddress");
    }
    expect(await ctx.manager.trustedForwarder()).to.equal(ctx.forwarder.target);
    expect(await ctx.manager.isTrustedForwarder(ctx.forwarder.target)).to.equal(true);
    expect(await ctx.manager.isTrustedForwarder(ctx.stranger.address)).to.equal(false);
    expect(await ctx.manager.stablecoin()).to.equal(ctx.idrx.target);
  });
});
