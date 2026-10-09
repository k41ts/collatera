const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { TypedDataEncoder } = require("ethers");
const f = require("./fixture");
const { ethers, time, E, IDR, DAY } = f;

describe("EIP-712: kontrak vs ethers", () => {
  it("domain separator dan struct hash sama persis dengan TypedDataEncoder", async () => {
    const ctx = await loadFixture(f.deployAll);
    expect(await ctx.manager.DOMAIN_SEPARATOR()).to.equal(TypedDataEncoder.hashDomain(ctx.domain));
    const note = await f.buildNote(ctx);
    expect(await ctx.manager.noteHash(note)).to.equal(E.noteStructHash(note));
  });
});

describe("MockIDRX", () => {
  it("ERC-20 dasar: transfer, approve, transferFrom, allowance tak hingga", async () => {
    const { idrx, creditor, debtor, stranger } = await loadFixture(f.deployAll);
    await expect(idrx.connect(creditor).transfer(stranger.address, IDR(5)))
      .to.emit(idrx, "Transfer")
      .withArgs(creditor.address, stranger.address, IDR(5));
    await idrx.connect(creditor).approve(debtor.address, ethers.MaxUint256);
    await idrx.connect(debtor).transferFrom(creditor.address, stranger.address, IDR(10));
    expect(await idrx.allowance(creditor.address, debtor.address)).to.equal(ethers.MaxUint256);
    expect(await idrx.balanceOf(stranger.address)).to.equal(IDR(15));
  });

  it("menolak saldo kurang, allowance kurang, dan transfer ke address(0)", async () => {
    const { idrx, creditor, stranger } = await loadFixture(f.deployAll);
    await expect(idrx.connect(stranger).transfer(creditor.address, 1)).to.be.revertedWithCustomError(idrx, "InsufficientBalance");
    await expect(idrx.connect(stranger).transferFrom(creditor.address, stranger.address, 1)).to.be.revertedWithCustomError(
      idrx,
      "InsufficientAllowance"
    );
    await expect(idrx.connect(creditor).transfer(ethers.ZeroAddress, 1)).to.be.revertedWithCustomError(idrx, "InvalidRecipient");
  });

  it("permit ERC-2612: berhasil, nonce naik, replay/expired/penanda tangan salah ditolak", async () => {
    const { idrx, creditor, stranger } = await loadFixture(f.deployAll);
    const deadline = (await time.latest()) + DAY;
    const p = await f.signPermit(idrx, creditor, stranger.address, IDR(123), deadline);
    await idrx.permit(creditor.address, stranger.address, IDR(123), deadline, p.v, p.r, p.s);
    expect(await idrx.allowance(creditor.address, stranger.address)).to.equal(IDR(123));
    expect(await idrx.nonces(creditor.address)).to.equal(1n);

    await expect(idrx.permit(creditor.address, stranger.address, IDR(123), deadline, p.v, p.r, p.s)).to.be.revertedWithCustomError(
      idrx,
      "PermitInvalidSigner"
    );

    const p2 = await f.signPermit(idrx, creditor, stranger.address, IDR(1), deadline);
    await expect(idrx.permit(stranger.address, stranger.address, IDR(1), deadline, p2.v, p2.r, p2.s)).to.be.revertedWithCustomError(
      idrx,
      "PermitInvalidSigner"
    );

    const old = (await time.latest()) - 1;
    const p3 = await f.signPermit(idrx, creditor, stranger.address, IDR(1), old);
    await expect(idrx.permit(creditor.address, stranger.address, IDR(1), old, p3.v, p3.r, p3.s)).to.be.revertedWithCustomError(
      idrx,
      "PermitExpired"
    );
  });

  it("menolak signature malleable (s tinggi)", async () => {
    const { idrx, creditor, stranger } = await loadFixture(f.deployAll);
    const deadline = (await time.latest()) + DAY;
    const p = await f.signPermit(idrx, creditor, stranger.address, IDR(1), deadline);
    const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    const sHigh = "0x" + (N - BigInt(p.s)).toString(16).padStart(64, "0");
    const vFlip = p.v === 27 ? 28 : 27;
    await expect(idrx.permit(creditor.address, stranger.address, IDR(1), deadline, vFlip, p.r, sHigh)).to.be.revertedWithCustomError(
      idrx,
      "PermitInvalidSigner"
    );
  });

  it("mint hanya owner; faucet punya cooldown 24 jam dan bisa dimatikan", async () => {
    const { idrx, admin, stranger } = await loadFixture(f.deployAll);
    await expect(idrx.connect(stranger).mint(stranger.address, 1)).to.be.revertedWithCustomError(idrx, "NotOwner");
    await expect(idrx.connect(stranger).setFaucetAmount(1)).to.be.revertedWithCustomError(idrx, "NotOwner");
    await idrx.connect(stranger).faucet();
    expect(await idrx.balanceOf(stranger.address)).to.equal(IDR(10_000_000));
    await expect(idrx.connect(stranger).faucet()).to.be.revertedWithCustomError(idrx, "FaucetCooldown");
    await time.increase(DAY + 1);
    await idrx.connect(stranger).faucet();
    expect(await idrx.totalSupply()).to.be.gt(0n);

    await idrx.connect(admin).setFaucetAmount(0);
    await expect(idrx.connect(stranger).faucet()).to.be.revertedWithCustomError(idrx, "FaucetDisabled");
    await expect(idrx.connect(admin).mint(ethers.ZeroAddress, 1)).to.be.revertedWithCustomError(idrx, "InvalidRecipient");
  });
});

describe("DebtNote (ERC-721 non-transferable)", () => {
  it("mint/burn hanya oleh DebtManager; setManager hanya sekali oleh deployer", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { debtNote, creditor, stranger, admin } = ctx;
    await expect(debtNote.connect(creditor).mint(creditor.address, 1)).to.be.revertedWithCustomError(debtNote, "NotManager");
    await expect(debtNote.connect(creditor).burn(1)).to.be.revertedWithCustomError(debtNote, "NotManager");
    await expect(debtNote.setManager(stranger.address)).to.be.revertedWithCustomError(debtNote, "ManagerAlreadySet");
    const fresh = await ethers.deployContract("DebtNote");
    await expect(fresh.connect(stranger).setManager(stranger.address)).to.be.revertedWithCustomError(fresh, "NotInitializer");
    await expect(fresh.setManager(ethers.ZeroAddress)).to.be.revertedWithCustomError(fresh, "InvalidAddress");
    await fresh.setManager(admin.address);
    // mint langsung sebagai "manager" untuk menguji cabang error
    await fresh.connect(admin).mint(creditor.address, 7);
    await expect(fresh.connect(admin).mint(creditor.address, 7)).to.be.revertedWithCustomError(fresh, "AlreadyMinted");
    await expect(fresh.connect(admin).mint(ethers.ZeroAddress, 8)).to.be.revertedWithCustomError(fresh, "InvalidAddress");
    await expect(fresh.connect(admin).burn(99)).to.be.revertedWithCustomError(fresh, "NonexistentToken");
    await expect(fresh.balanceOf(ethers.ZeroAddress)).to.be.revertedWithCustomError(fresh, "InvalidAddress");
    await expect(fresh.ownerOf(99)).to.be.revertedWithCustomError(fresh, "NonexistentToken");
  });

  it("transfer, approval, dan operator semuanya terkunci; ERC-165/5192 benar", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { debtNote, manager, creditor, debtor, stranger } = ctx;
    const note = await f.buildNote(ctx);
    await f.activateOnchain(ctx, note);
    const id = BigInt(note.noteId);

    expect(await debtNote.ownerOf(id)).to.equal(creditor.address);
    expect(await debtNote.balanceOf(creditor.address)).to.equal(1n);
    expect(await debtNote.locked(id)).to.equal(true);
    expect(await debtNote.getApproved(id)).to.equal(ethers.ZeroAddress);
    expect(await debtNote.isApprovedForAll(creditor.address, stranger.address)).to.equal(false);

    const n = debtNote.connect(creditor);
    await expect(n.transferFrom(creditor.address, debtor.address, id)).to.be.revertedWithCustomError(debtNote, "Soulbound");
    await expect(n["safeTransferFrom(address,address,uint256)"](creditor.address, debtor.address, id)).to.be.revertedWithCustomError(
      debtNote,
      "Soulbound"
    );
    await expect(
      n["safeTransferFrom(address,address,uint256,bytes)"](creditor.address, debtor.address, id, "0x")
    ).to.be.revertedWithCustomError(debtNote, "Soulbound");
    await expect(n.approve(debtor.address, id)).to.be.revertedWithCustomError(debtNote, "Soulbound");
    await expect(n.setApprovalForAll(debtor.address, true)).to.be.revertedWithCustomError(debtNote, "Soulbound");

    for (const iid of ["0x01ffc9a7", "0x80ac58cd", "0x5b5e139f", "0xb45a3c0e"]) {
      expect(await debtNote.supportsInterface(iid)).to.equal(true);
    }
    expect(await debtNote.supportsInterface("0xffffffff")).to.equal(false);
    expect(await manager.debtNote()).to.equal(debtNote.target);
  });

  it("tokenURI memuat metadata on-chain dan revert setelah burn", async () => {
    const ctx = await loadFixture(f.deployAll);
    const { debtNote, manager } = ctx;
    const note = await f.buildNote(ctx, { totalOwed: IDR(1_000_000) });
    await f.activateOnchain(ctx, note);
    const uri = await debtNote.tokenURI(BigInt(note.noteId));
    expect(uri.startsWith("data:application/json;utf8,")).to.equal(true);
    const json = JSON.parse(uri.slice("data:application/json;utf8,".length));
    const attr = Object.fromEntries(json.attributes.map((a) => [a.trait_type, a.value]));
    expect(attr.noteId).to.equal(note.noteId);
    expect(attr.docHash).to.equal(note.docHash);
    expect(attr.principal).to.equal(Number(note.principal));
    expect(attr.dueDate).to.equal(note.dueDate);
    expect(attr.creditor).to.equal(ctx.creditor.address.toLowerCase());
    expect(attr.debtor).to.equal(ctx.debtor.address.toLowerCase());
    expect(attr.status).to.equal("ACTIVE");

    await time.increaseTo(note.dueDate + 1);
    const late = JSON.parse((await debtNote.tokenURI(BigInt(note.noteId))).slice(27));
    expect(late.attributes.find((a) => a.trait_type === "status").value).to.equal("OVERDUE");

    // denda berjalan per detik: kirim sedikit lebih; kontrak hanya menarik sisa utang saat tx dieksekusi
    await f.payOnchain(ctx, note.noteId, (await manager.remaining(note.noteId)) + IDR(1));
    await expect(debtNote.tokenURI(BigInt(note.noteId))).to.be.revertedWithCustomError(debtNote, "NonexistentToken");
  });
});

describe("PiutangForwarder (gasless)", () => {
  async function req(ctx, overrides = {}) {
    const data = ctx.manager.interface.encodeFunctionData("openDispute", [ethers.id("x"), ethers.id("alasan")]);
    return {
      from: ctx.debtor.address,
      to: ctx.manager.target,
      gas: 500_000n,
      nonce: await ctx.forwarder.nonces(ctx.debtor.address),
      deadline: (await time.latest()) + DAY,
      data,
      ...overrides,
    };
  }
  const sign = (ctx, signer, r) => signer.signTypedData(E.forwarderDomain(ctx.chainId, ctx.forwarder.target), E.FORWARD_TYPES, r);

  it("meneruskan pemanggil asli ke DebtManager; nonce naik; replay ditolak", async () => {
    const ctx = await loadFixture(f.deployAll);
    const note = await f.buildNote(ctx);
    await f.activateOnchain(ctx, note);
    const data = ctx.manager.interface.encodeFunctionData("openDispute", [note.noteId, ethers.id("alasan")]);
    const r = await req(ctx, { data });
    const sig = await sign(ctx, ctx.debtor, r);
    expect(await ctx.forwarder.verify(r, sig)).to.equal(true);

    await expect(ctx.forwarder.connect(ctx.relayer).execute(r, sig))
      .to.emit(ctx.manager, "DisputeOpened")
      .withArgs(note.noteId, ctx.debtor.address, ethers.id("alasan"))
      .and.to.emit(ctx.forwarder, "Forwarded");
    expect(await ctx.forwarder.nonces(ctx.debtor.address)).to.equal(1n);
    expect(await ctx.forwarder.verify(r, sig)).to.equal(false);
    await expect(ctx.forwarder.connect(ctx.relayer).execute(r, sig))
      .to.be.revertedWithCustomError(ctx.forwarder, "InvalidNonce")
      .withArgs(1n);
  });

  it("menolak signature salah, kedaluwarsa, dan target bukan kontrak", async () => {
    const ctx = await loadFixture(f.deployAll);
    const r = await req(ctx);
    const badSig = await sign(ctx, ctx.stranger, r);
    await expect(ctx.forwarder.execute(r, badSig)).to.be.revertedWithCustomError(ctx.forwarder, "InvalidSignature");

    const expired = await req(ctx, { deadline: (await time.latest()) - 1 });
    await expect(ctx.forwarder.execute(expired, await sign(ctx, ctx.debtor, expired))).to.be.revertedWithCustomError(
      ctx.forwarder,
      "RequestExpired"
    );

    const eoa = await req(ctx, { to: ctx.stranger.address });
    await expect(ctx.forwarder.execute(eoa, await sign(ctx, ctx.debtor, eoa))).to.be.revertedWithCustomError(
      ctx.forwarder,
      "TargetNotAllowed" // sejak T5 target selain DebtManager ditolak lebih dulu
    );
  });

  it("revert dari target diteruskan apa adanya (nonce tidak terpakai)", async () => {
    const ctx = await loadFixture(f.deployAll);
    const r = await req(ctx); // noteId "x" tidak ada → NoteNotFound
    const sig = await sign(ctx, ctx.debtor, r);
    await expect(ctx.forwarder.execute(r, sig)).to.be.revertedWithCustomError(ctx.manager, "NoteNotFound");
    expect(await ctx.forwarder.nonces(ctx.debtor.address)).to.equal(0n);
  });

  it("revert tanpa data → CallFailed", async () => {
    const ctx = await loadFixture(f.deployAll);
    // idrx.faucet tidak revert; panggil fungsi yang tidak ada di DebtManager → revert tanpa data (tidak ada fallback)
    const r = await req(ctx, { data: "0xdeadbeef" });
    await expect(ctx.forwarder.execute(r, await sign(ctx, ctx.debtor, r))).to.be.revertedWithCustomError(ctx.forwarder, "CallFailed");
  });

  it("alamat yang ditempel pemanggil biasa TIDAK dianggap pengirim (anti-spoof)", async () => {
    const ctx = await loadFixture(f.deployAll);
    const note = await f.buildNote(ctx);
    await f.activateOnchain(ctx, note);
    // stranger memanggil manager langsung dengan alamat debitur ditempel di akhir calldata
    const data =
      ctx.manager.interface.encodeFunctionData("openDispute", [note.noteId, ethers.id("spoof")]) +
      ctx.debtor.address.slice(2);
    await expect(ctx.stranger.sendTransaction({ to: ctx.manager.target, data })).to.be.revertedWithCustomError(
      ctx.manager,
      "NotParty"
    );
  });
});
