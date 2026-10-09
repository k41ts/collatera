// SERANGAN 4: signature EIP-712, replay, dan meta-transaction (ERC-2771) dari sudut pandang penyerang.
//
// Setiap test mencoba satu teknik serangan dan memastikan kontrak menolaknya, lalu (bila relevan) membuktikan
// bahwa jalur yang sah tetap berfungsi setelahnya. Termasuk: signature malleable, v=0/1, format 64 byte,
// domain salah (chainId, kontrak, nama, versi), mutasi SETIAP field, tukar peran, replay lintas tipe struct,
// replay lintas piutang, smart wallet (ERC-1271), forwarder palsu, dan pemalsuan alamat di calldata.
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers, time, expect, E, IDR, DAY, NO_PERMIT, deployStress, openNote, signPayment, nextId, nextNonce } = require("./lib/setup");

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const REASON = ethers.id("serangan");

const fixture = () => deployStress(4);

async function draft(ctx, over = {}) {
  const [creditor, , debtor] = ctx.parties;
  const now = await time.latest();
  const schedule = { dueDates: [now + 30 * DAY], amounts: [IDR(1_100_000)] };
  const note = {
    noteId: nextId("atk-note"),
    version: 1,
    creditor: creditor.address,
    debtor: debtor.address,
    docHash: nextId("atk-doc"),
    scheduleHash: E.scheduleHash(schedule),
    principal: IDR(1_000_000),
    totalOwed: IDR(1_100_000),
    lateFeeBps: 200,
    dueDate: schedule.dueDates[0],
    disbursement: 0,
    deadline: now + 7 * DAY,
    creditorNonce: nextNonce(),
    debtorNonce: nextNonce(),
    ...over,
  };
  return { note, schedule, creditor, debtor };
}

const sign = (signer, ctx, note, domain = ctx.domain) => signer.signTypedData(domain, E.NOTE_TYPES, note);

/** Signature "kembaran" yang malleable: s' = n − s, v dibalik. Valid secara matematis untuk pesan yang sama. */
function malleate(sig) {
  const r = sig.slice(2, 66);
  const s = BigInt("0x" + sig.slice(66, 130));
  const v = parseInt(sig.slice(130, 132), 16);
  const s2 = (SECP256K1_N - s).toString(16).padStart(64, "0");
  return "0x" + r + s2 + (v === 27 ? "1c" : "1b");
}

describe("STRESS 4 · serangan signature, replay, dan meta-transaction", function () {
  this.timeout(0);

  describe("signature perjanjian (Note)", () => {
    it("menolak signature malleable, v=0/1, format 64 byte, kosong, nol, dan acak — lalu signature asli tetap sah", async () => {
      const ctx = await loadFixture(fixture);
      const { manager, relayer } = ctx;
      const { note, schedule, creditor, debtor } = await draft(ctx);
      const sigC = await sign(creditor, ctx, note);
      const sigD = await sign(debtor, ctx, note);

      const vMinus27 = sigC.slice(0, 130) + (parseInt(sigC.slice(130), 16) - 27).toString(16).padStart(2, "0");
      const compact64 = (() => {
        // EIP-2098: r || (yParity << 255 | s)
        const s = BigInt("0x" + sigC.slice(66, 130));
        const yParity = BigInt(parseInt(sigC.slice(130), 16) - 27);
        return "0x" + sigC.slice(2, 66) + ((yParity << 255n) | s).toString(16).padStart(64, "0");
      })();
      const bad = {
        malleable: malleate(sigC),
        "v=0/1": vMinus27,
        "64 byte (EIP-2098)": compact64,
        kosong: "0x",
        "65 byte nol": "0x" + "00".repeat(65),
        acak: ethers.hexlify(ethers.randomBytes(65)),
        "66 byte": sigC + "00",
      };
      for (const [name, sig] of Object.entries(bad)) {
        await expect(manager.connect(relayer).depositEscrow.staticCall(note, sig, NO_PERMIT), name)
          .to.be.revertedWithCustomError(manager, "InvalidSignature")
          .withArgs(creditor.address);
      }
      await manager.connect(relayer).depositEscrow(note, sigC, NO_PERMIT);
      for (const [name, sig] of Object.entries({ ...bad, malleable: malleate(sigD) })) {
        await expect(manager.connect(relayer).activateOnchain.staticCall(note, schedule, sigC, sig), `debitur ${name}`)
          .to.be.revertedWithCustomError(manager, "InvalidSignature")
          .withArgs(debtor.address);
      }
      await manager.connect(relayer).activateOnchain(note, schedule, sigC, sigD);
    });

    it("menolak signature untuk domain lain: chainId, kontrak lain, nama, versi", async () => {
      const ctx = await loadFixture(fixture);
      const { manager, relayer, chainId } = ctx;
      const { note, creditor } = await draft(ctx);
      const other = await ethers.deployContract("DebtManager", [ctx.debtNote.target, ctx.idrx.target, ctx.forwarder.target, ctx.admin.address]);
      const domains = {
        "chainId mainnet": E.managerDomain(1n, manager.target),
        "kontrak DebtManager lain": E.managerDomain(chainId, other.target),
        "nama domain salah": { ...ctx.domain, name: "PiutangChainX" },
        "versi domain salah": { ...ctx.domain, version: "2" },
        "domain forwarder": E.forwarderDomain(chainId, manager.target),
      };
      for (const [name, domain] of Object.entries(domains)) {
        const sig = await sign(creditor, ctx, note, domain);
        await expect(manager.connect(relayer).depositEscrow.staticCall(note, sig, NO_PERMIT), name).to.be.revertedWithCustomError(
          manager,
          "InvalidSignature"
        );
      }
      // dan signature yang sah untuk kontrak ini tidak berlaku di kontrak lain
      const sig = await sign(creditor, ctx, note);
      await expect(other.connect(relayer).depositEscrow.staticCall(note, sig, NO_PERMIT)).to.be.revertedWithCustomError(other, "InvalidSignature");
    });

    it("mutasi SETIAP field Note setelah ditandatangani membuat signature tidak berlaku", async () => {
      const ctx = await loadFixture(fixture);
      const { manager, relayer, parties } = ctx;
      const { note, creditor } = await draft(ctx);
      const sigC = await sign(creditor, ctx, note);
      const mutations = {
        noteId: nextId("lain"),
        version: note.version + 1,
        creditor: parties[1].address,
        debtor: parties[3].address,
        docHash: nextId("doc-lain"),
        scheduleHash: nextId("jadwal-lain"),
        principal: note.principal - 1n,
        totalOwed: note.totalOwed + 1n,
        lateFeeBps: 0,
        dueDate: note.dueDate + 1,
        deadline: note.deadline + 1,
        creditorNonce: note.creditorNonce + 1n,
        debtorNonce: note.debtorNonce + 1n,
      };
      for (const [field, value] of Object.entries(mutations)) {
        await expect(manager.connect(relayer).depositEscrow.staticCall({ ...note, [field]: value }, sigC, NO_PERMIT), field).to.be.revertedWithCustomError(
          manager,
          "InvalidSignature"
        );
      }
      await expect(manager.connect(relayer).depositEscrow.staticCall({ ...note, disbursement: 1 }, sigC, NO_PERMIT)).to.be.revertedWithCustomError(
        manager,
        "WrongDisbursement"
      );
    });

    it("menolak tukar peran: signature ditukar, atau kreditur menandatangani dua kali", async () => {
      const ctx = await loadFixture(fixture);
      const { manager, relayer } = ctx;
      const { note, schedule, creditor, debtor } = await draft(ctx);
      const sigC = await sign(creditor, ctx, note);
      const sigD = await sign(debtor, ctx, note);
      await manager.connect(relayer).depositEscrow(note, sigC, NO_PERMIT);
      await expect(manager.activateOnchain.staticCall(note, schedule, sigD, sigC))
        .to.be.revertedWithCustomError(manager, "InvalidSignature")
        .withArgs(creditor.address);
      await expect(manager.activateOnchain.staticCall(note, schedule, sigC, sigC))
        .to.be.revertedWithCustomError(manager, "InvalidSignature")
        .withArgs(debtor.address);
      // debitur tidak bisa menyetor escrow atas nama kreditur dengan signature-nya sendiri
      await expect(manager.depositEscrow.staticCall({ ...note, noteId: nextId("x") }, sigD, NO_PERMIT)).to.be.revertedWithCustomError(
        manager,
        "InvalidSignature"
      );
    });
  });

  describe("replay lintas tipe struct dan lintas piutang", () => {
    it("signature Note (atau struct lain yang isinya mirip) tidak bisa dipakai sebagai konfirmasi pembayaran", async () => {
      const ctx = await loadFixture(fixture);
      const { manager, relayer } = ctx;
      const [creditor, , debtor] = ctx.parties;
      const now = await time.latest();
      const e = await openNote(ctx, { creditor, debtor, schedule: { dueDates: [now + 30 * DAY], amounts: [IDR(500_000)] } });
      const noteSig = await creditor.signTypedData(ctx.domain, E.NOTE_TYPES, e.note);

      const c = { noteId: e.note.noteId, amount: IDR(1), proofHash: nextId("p"), installmentIndex: 0, nonce: nextNonce(), deadline: now + DAY, settleFull: false };
      await expect(manager.connect(relayer).recordOffchainPayment.staticCall(c, noteSig)).to.be.revertedWithCustomError(manager, "InvalidSignature");

      // struct lain dengan isi "mirip" tapi typehash berbeda
      const asReceipt = await creditor.signTypedData(ctx.domain, E.RECEIPT_TYPES, {
        noteHash: e.note.noteId,
        proofHash: c.proofHash,
        amount: c.amount,
        nonce: c.nonce,
        deadline: c.deadline,
      });
      await expect(manager.connect(relayer).recordOffchainPayment.staticCall(c, asReceipt)).to.be.revertedWithCustomError(manager, "InvalidSignature");
    });

    it("konfirmasi pembayaran: mutasi field, replay bukti, replay nonce dengan bukti baru, dan pindah ke piutang lain", async () => {
      const ctx = await loadFixture(fixture);
      const { manager, relayer } = ctx;
      const [creditor, , debtor, debtor2] = ctx.parties;
      const now = await time.latest();
      const a = await openNote(ctx, { creditor, debtor, schedule: { dueDates: [now + 30 * DAY], amounts: [IDR(500_000)] } });
      const b = await openNote(ctx, { creditor, debtor: debtor2, schedule: { dueDates: [now + 30 * DAY], amounts: [IDR(500_000)] } });

      const { c, sig } = await signPayment(ctx, creditor, a.note.noteId, IDR(1_000), now + DAY);
      const mutations = {
        noteId: b.note.noteId, // piutang lain milik kreditur yang sama
        amount: IDR(1_001),
        proofHash: nextId("bukti-lain"),
        installmentIndex: 1,
        nonce: c.nonce + 1n,
        deadline: c.deadline + 1,
      };
      for (const [field, value] of Object.entries(mutations)) {
        await expect(manager.connect(relayer).recordOffchainPayment.staticCall({ ...c, [field]: value }, sig), field).to.be.revertedWithCustomError(
          manager,
          "InvalidSignature"
        );
      }
      await manager.connect(relayer).recordOffchainPayment(c, sig);
      await expect(manager.connect(relayer).recordOffchainPayment.staticCall(c, sig)).to.be.revertedWithCustomError(manager, "ProofAlreadyUsed");

      const sameNonce = { ...c, proofHash: nextId("bukti-baru") };
      const sig2 = await creditor.signTypedData(ctx.domain, E.PAYMENT_TYPES, sameNonce);
      await expect(manager.connect(relayer).recordOffchainPayment.staticCall(sameNonce, sig2)).to.be.revertedWithCustomError(manager, "NonceAlreadyUsed");
      expect(await manager.remaining(a.note.noteId)).to.equal(IDR(499_000));
      expect(await manager.remaining(b.note.noteId)).to.equal(IDR(500_000));
    });

    it("nonce bersifat global per penanda tangan: nonce yang dipakai konfirmasi bayar memblokir Note dengan nonce sama", async () => {
      const ctx = await loadFixture(fixture);
      const { manager, relayer } = ctx;
      const [creditor, , debtor] = ctx.parties;
      const now = await time.latest();
      const live = await openNote(ctx, { creditor, debtor, schedule: { dueDates: [now + 30 * DAY], amounts: [IDR(500_000)] } });
      const shared = nextNonce();
      const c = { noteId: live.note.noteId, amount: IDR(1), proofHash: nextId("p"), installmentIndex: 0, nonce: shared, deadline: now + DAY, settleFull: false };
      await manager.connect(relayer).recordOffchainPayment(c, await creditor.signTypedData(ctx.domain, E.PAYMENT_TYPES, c));

      const { note } = await draft(ctx, { creditorNonce: shared });
      await expect(manager.connect(relayer).depositEscrow.staticCall(note, await sign(creditor, ctx, note), NO_PERMIT))
        .to.be.revertedWithCustomError(manager, "NonceAlreadyUsed")
        .withArgs(creditor.address, shared);
    });

    it("receipt pencairan untuk versi draft lain, nominal lain, atau ditandatangani kreditur ditolak", async () => {
      const ctx = await loadFixture(fixture);
      const { manager, relayer } = ctx;
      const { note, schedule, creditor, debtor } = await draft(ctx, { disbursement: 1 });
      const v2 = { ...note, version: 2, docHash: nextId("doc-v2") };
      const sigC = await sign(creditor, ctx, note);
      const sigD = await sign(debtor, ctx, note);
      const receipt = (over) => ({ noteHash: E.noteStructHash(note), proofHash: nextId("r"), amount: note.principal, nonce: nextNonce(), deadline: note.deadline, ...over });

      const forV2 = receipt({ noteHash: E.noteStructHash(v2) });
      await expect(
        manager.connect(relayer).activateOffchain.staticCall(note, schedule, sigC, sigD, forV2, await debtor.signTypedData(ctx.domain, E.RECEIPT_TYPES, forV2))
      ).to.be.revertedWithCustomError(manager, "ReceiptMismatch");
      const less = receipt({ amount: note.principal - 1n });
      await expect(
        manager.connect(relayer).activateOffchain.staticCall(note, schedule, sigC, sigD, less, await debtor.signTypedData(ctx.domain, E.RECEIPT_TYPES, less))
      ).to.be.revertedWithCustomError(manager, "ReceiptMismatch");
      const byCreditor = receipt();
      await expect(
        manager.connect(relayer).activateOffchain.staticCall(note, schedule, sigC, sigD, byCreditor, await creditor.signTypedData(ctx.domain, E.RECEIPT_TYPES, byCreditor))
      )
        .to.be.revertedWithCustomError(manager, "InvalidSignature")
        .withArgs(debtor.address);
      const ok = receipt();
      await manager.connect(relayer).activateOffchain(note, schedule, sigC, sigD, ok, await debtor.signTypedData(ctx.domain, E.RECEIPT_TYPES, ok));
    });

    it("revisi: replay ke piutang lain, lompat versi, dipakai dua kali, atau hanya satu pihak menandatangani", async () => {
      const ctx = await loadFixture(fixture);
      const { manager, relayer } = ctx;
      const [creditor, , debtor] = ctx.parties;
      const now = await time.latest();
      const s0 = { dueDates: [now + 30 * DAY], amounts: [IDR(500_000)] };
      const a = await openNote(ctx, { creditor, debtor, schedule: s0 });
      const b = await openNote(ctx, { creditor, debtor, schedule: s0 });
      const schedule = { dueDates: [now + 60 * DAY], amounts: [IDR(500_000)] };
      const am = (over = {}) => ({
        noteId: a.note.noteId,
        newVersion: 2,
        newDocHash: nextId("rev"),
        newScheduleHash: E.scheduleHash(schedule),
        newTotalOwed: IDR(500_000),
        newLateFeeBps: 200,
        newDueDate: schedule.dueDates[0],
        deadline: now + DAY,
        creditorNonce: nextNonce(),
        debtorNonce: nextNonce(),
        ...over,
      });
      const both = async (x) => [await creditor.signTypedData(ctx.domain, E.AMENDMENT_TYPES, x), await debtor.signTypedData(ctx.domain, E.AMENDMENT_TYPES, x)];

      const x = am();
      const [c, d] = await both(x);
      await expect(manager.connect(relayer).amend.staticCall({ ...x, noteId: b.note.noteId }, schedule, c, d)).to.be.revertedWithCustomError(manager, "InvalidSignature");
      const skip = am({ newVersion: 3 });
      await expect(manager.connect(relayer).amend.staticCall(skip, schedule, ...(await both(skip)))).to.be.revertedWithCustomError(manager, "InvalidVersion");
      await expect(manager.connect(relayer).amend.staticCall(x, schedule, c, c)).to.be.revertedWithCustomError(manager, "InvalidSignature");
      // jadwal yang dikirim berbeda dari yang ditandatangani
      await expect(
        manager.connect(relayer).amend.staticCall(x, { dueDates: [now + 61 * DAY], amounts: [IDR(500_000)] }, c, d)
      ).to.be.revertedWithCustomError(manager, "ScheduleMismatch");
      await manager.connect(relayer).amend(x, schedule, c, d);
      await expect(manager.connect(relayer).amend.staticCall(x, schedule, c, d)).to.be.revertedWithCustomError(manager, "InvalidVersion");
    });
  });

  describe("smart wallet (ERC-1271)", () => {
    it("wallet hanya sah dengan signature pemiliknya; kontrak tanpa isValidSignature ditolak", async () => {
      const ctx = await loadFixture(fixture);
      const { manager, relayer, idrx } = ctx;
      const [owner, attacker] = ctx.parties;
      const wallet = await ethers.deployContract("MockERC1271Wallet", [owner.address]);
      const { note } = await draft(ctx, { creditor: wallet.target });
      await expect(manager.connect(relayer).depositEscrow.staticCall(note, await sign(attacker, ctx, note), NO_PERMIT))
        .to.be.revertedWithCustomError(manager, "InvalidSignature")
        .withArgs(wallet.target);
      // kontrak token (punya code, tidak punya isValidSignature) sebagai "kreditur"
      const { note: n2 } = await draft(ctx, { creditor: idrx.target });
      await expect(manager.connect(relayer).depositEscrow.staticCall(n2, await sign(owner, ctx, n2), NO_PERMIT)).to.be.revertedWithCustomError(
        manager,
        "InvalidSignature"
      );
      // signature pemilik sah (gagal hanya karena wallet belum punya saldo/allowance)
      await expect(manager.connect(relayer).depositEscrow.staticCall(note, await sign(owner, ctx, note), NO_PERMIT)).to.be.revertedWithCustomError(
        manager,
        "TransferFailed"
      );
    });
  });

  describe("meta-transaction (ERC-2771)", () => {
    async function request(ctx, signer, data, over = {}, forwarder = ctx.forwarder) {
      const r = {
        from: signer.address,
        to: ctx.manager.target,
        gas: 500_000n,
        nonce: await forwarder.nonces(signer.address),
        deadline: (await time.latest()) + DAY,
        data,
        ...over,
      };
      const sig = await signer.signTypedData(E.forwarderDomain(ctx.chainId, forwarder.target), E.FORWARD_TYPES, r);
      return { r, sig };
    }

    it("alamat yang ditempel di calldata TIDAK dipercaya jika pengirimnya bukan forwarder resmi", async () => {
      const ctx = await loadFixture(fixture);
      const { manager, stranger, admin } = ctx;
      const [creditor, , debtor] = ctx.parties;
      const now = await time.latest();
      const e = await openNote(ctx, { creditor, debtor, schedule: { dueDates: [now + 30 * DAY], amounts: [IDR(500_000)] } });
      const spoof = (fn, args, as) =>
        stranger.sendTransaction({ to: manager.target, data: manager.interface.encodeFunctionData(fn, args) + as.slice(2).toLowerCase() });
      await expect(spoof("openDispute", [e.note.noteId, REASON], debtor.address)).to.be.revertedWithCustomError(manager, "NotParty");
      await expect(spoof("markPaid", [e.note.noteId], creditor.address)).to.be.revertedWithCustomError(manager, "NotCreditor");
      await expect(spoof("freeze", [e.note.noteId, REASON], admin.address)).to.be.revertedWithCustomError(manager, "AccessControlUnauthorizedAccount");
      await expect(spoof("pause", [], admin.address)).to.be.revertedWithCustomError(manager, "AccessControlUnauthorizedAccount");
    });

    it("forwarder tiruan tidak bisa mengatasnamakan pengguna; request untuk forwarder resmi tidak berlaku di tiruan", async () => {
      const ctx = await loadFixture(fixture);
      const { manager, relayer } = ctx;
      const [creditor, , debtor] = ctx.parties;
      const now = await time.latest();
      const e = await openNote(ctx, { creditor, debtor, schedule: { dueDates: [now + 30 * DAY], amounts: [IDR(500_000)] } });
      const fake = await ethers.deployContract("PiutangForwarder");
      const data = manager.interface.encodeFunctionData("openDispute", [e.note.noteId, REASON]);

      const viaFake = await request(ctx, debtor, data, {}, fake);
      await expect(fake.connect(relayer).execute(viaFake.r, viaFake.sig)).to.be.revertedWithCustomError(manager, "NotParty");
      const forReal = await request(ctx, debtor, data);
      await expect(fake.connect(relayer).execute(forReal.r, forReal.sig)).to.be.revertedWithCustomError(fake, "InvalidSignature");
      await ctx.forwarder.connect(relayer).execute(forReal.r, forReal.sig);
      expect(await manager.statusOf(e.note.noteId)).to.equal(4n); // DISPUTED
    });

    it("request forwarder: mutasi field, replay, nonce loncat, kedaluwarsa, target bukan kontrak", async () => {
      const ctx = await loadFixture(fixture);
      const { manager, relayer, forwarder, stranger } = ctx;
      const [creditor, , debtor] = ctx.parties;
      const now = await time.latest();
      const e = await openNote(ctx, { creditor, debtor, schedule: { dueDates: [now + 30 * DAY], amounts: [IDR(500_000)] } });
      const data = manager.interface.encodeFunctionData("openDispute", [e.note.noteId, REASON]);
      const { r, sig } = await request(ctx, debtor, data);

      const mutations = { from: stranger.address, to: ctx.idrx.target, gas: r.gas + 1n, deadline: r.deadline + 1, data: data + "00" };
      for (const [field, value] of Object.entries(mutations)) {
        await expect(forwarder.connect(relayer).execute({ ...r, [field]: value }, sig), field).to.be.reverted;
        expect(await forwarder.verify({ ...r, [field]: value }, sig), field).to.equal(false);
      }
      await expect(forwarder.connect(relayer).execute({ ...r, nonce: r.nonce + 1n }, sig)).to.be.revertedWithCustomError(forwarder, "InvalidNonce");

      const expired = await request(ctx, debtor, data, { deadline: now - 1 });
      await expect(forwarder.connect(relayer).execute(expired.r, expired.sig)).to.be.revertedWithCustomError(forwarder, "RequestExpired");
      const eoaTarget = await request(ctx, debtor, data, { to: stranger.address });
      await expect(forwarder.connect(relayer).execute(eoaTarget.r, eoaTarget.sig)).to.be.revertedWithCustomError(forwarder, "TargetNotContract");

      await forwarder.connect(relayer).execute(r, sig);
      await expect(forwarder.connect(relayer).execute(r, sig)).to.be.revertedWithCustomError(forwarder, "InvalidNonce");
    });

    it("permit yang di-front-run pihak lain tidak menggagalkan pembayaran; permit untuk spender lain tidak memberi akses", async () => {
      const ctx = await loadFixture(fixture);
      const { manager, idrx, stranger, chainId } = ctx;
      const [creditor] = ctx.parties;
      const debtor = ctx.signers[15]; // tanpa approve sebelumnya
      await idrx.mint(debtor.address, IDR(1_000_000));
      const now = await time.latest();
      const e = await openNote(ctx, { creditor, debtor, schedule: { dueDates: [now + 30 * DAY], amounts: [IDR(500_000)] } });

      const permitFor = async (spender, value) => {
        const deadline = (await time.latest()) + DAY;
        const nonce = await idrx.nonces(debtor.address);
        const sig = await debtor.signTypedData(E.tokenDomain(chainId, idrx.target), E.PERMIT_TYPES, { owner: debtor.address, spender, value, nonce, deadline });
        return { deadline, ...E.splitSig(sig) };
      };
      // permit untuk spender lain: pembayaran gagal karena tidak ada allowance untuk DebtManager
      const wrong = await permitFor(stranger.address, IDR(1_000));
      await expect(manager.connect(debtor).payOnchain(e.note.noteId, IDR(1_000), 0, wrong)).to.be.revertedWithCustomError(manager, "TransferFailed");

      // penyerang mengirim permit debitur lebih dulu (nonce permit terpakai) → payOnchain tetap jalan
      const p = await permitFor(manager.target, IDR(1_000));
      await idrx.connect(stranger).permit(debtor.address, manager.target, IDR(1_000), p.deadline, p.v, p.r, p.s);
      await manager.connect(debtor).payOnchain(e.note.noteId, IDR(1_000), 0, p);
      expect(await manager.remaining(e.note.noteId)).to.equal(IDR(499_000));
      expect(await idrx.allowance(debtor.address, manager.target)).to.equal(0n);
    });
  });
});
