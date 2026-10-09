// FUZZ 3: perebutan escrow dan aktivasi sebelum piutang lahir.
//
// Setiap seed menyiapkan kumpulan draft yang sengaja saling bertabrakan:
//   - dua versi draft dengan noteId yang sama (hanya satu yang boleh aktif),
//   - dua piutang berbeda dengan docHash yang sama (anti double-mint),
//   - dua draft yang memakai nonce kreditur yang sama,
//   - draft off-chain (tidak boleh lewat escrow), dan deadline pendek yang bisa kedaluwarsa.
// Lalu urutan acak: setor escrow, refund, aktivasi on-chain/off-chain, cancelNonce, lompat waktu, dan pihak luar.
// Model mencatat escrow, nonce terpakai, noteId aktif, dan docHash terpakai, lalu dicek setelah setiap aksi:
//   - saldo kontrak == Σ escrow yang tercatat (tidak ada dana hilang atau tersangkut),
//   - escrow yang sudah disetor SELALU bisa ditarik kembali selama belum aktif, bahkan setelah deadline lewat.
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers, time, expect, E, prng, deployStress, SEEDS, STEPS, BASE_SEED, IDR, DAY, NO_PERMIT, nextId, nextNonce } = require("./lib/setup");
const { Ledger } = require("./lib/actions");

const fixture = () => deployStress(4);

async function buildPool(ctx, rng) {
  const [c1, c2, d1, d2] = ctx.parties;
  const now = await time.latest();
  const mk = async (over = {}) => {
    const schedule = { dueDates: [now + 30 * DAY, now + 60 * DAY], amounts: [IDR(rng.int(1, 900)), IDR(rng.int(1, 900))] };
    const creditor = over.creditor ?? rng.pick([c1, c2]);
    const debtor = over.debtor ?? rng.pick([d1, d2]);
    const note = {
      noteId: over.noteId ?? nextId("race-note"),
      version: over.version ?? 1,
      creditor: creditor.address,
      debtor: debtor.address,
      docHash: over.docHash ?? nextId("race-doc"),
      scheduleHash: E.scheduleHash(schedule),
      principal: IDR(rng.int(1, 500)),
      totalOwed: schedule.amounts[0] + schedule.amounts[1] + IDR(500),
      lateFeeBps: 200,
      dueDate: schedule.dueDates[1],
      disbursement: over.disbursement ?? 0,
      deadline: now + rng.int(1, 6) * DAY,
      creditorNonce: over.creditorNonce ?? nextNonce(),
      debtorNonce: nextNonce(),
    };
    // totalOwed harus = Σ jadwal
    schedule.amounts[1] = note.totalOwed - schedule.amounts[0];
    note.scheduleHash = E.scheduleHash(schedule);
    const sigC = await creditor.signTypedData(ctx.domain, E.NOTE_TYPES, note);
    const sigD = await debtor.signTypedData(ctx.domain, E.NOTE_TYPES, note);
    return { note, schedule, creditor, debtor, sigC, sigD, hash: E.noteStructHash(note) };
  };
  const pool = [];
  const sameId = nextId("race-same-id");
  pool.push(await mk({ noteId: sameId, version: 1 }), await mk({ noteId: sameId, version: 2 }));
  const sameDoc = nextId("race-same-doc");
  pool.push(await mk({ docHash: sameDoc }), await mk({ docHash: sameDoc }));
  const sharedNonce = nextNonce();
  pool.push(await mk({ creditor: c1, creditorNonce: sharedNonce }), await mk({ creditor: c1, creditorNonce: sharedNonce }));
  pool.push(await mk({ disbursement: 1 }), await mk({ disbursement: 1 }));
  pool.push(await mk(), await mk());
  return pool;
}

describe("STRESS 3 · perebutan escrow, tabrakan noteId/docHash/nonce sebelum aktivasi", function () {
  this.timeout(0);

  for (let i = 0; i < SEEDS; i++) {
    const seed = BASE_SEED + 2000 + i;
    it(`seed ${seed}: ${STEPS} aksi acak pra-aktivasi, dana selalu utuh`, async () => {
      const ctx = await loadFixture(fixture);
      const rng = prng(seed);
      const { manager, idrx, relayer, stranger } = ctx;
      const pool = await buildPool(ctx, rng);
      const book = new Ledger();
      await book.init(idrx, [...ctx.parties.map((p) => p.address), manager.target]);

      // model
      const escrow = new Map(); //   noteHash → nominal
      const used = new Set(); //     `${addr}:${nonce}`
      const activeIds = new Set();
      const usedDocs = new Set();
      const key = (a, n) => `${a.toLowerCase()}:${n}`;

      const validateNew = (p, now) => {
        const n = p.note;
        if (BigInt(n.deadline) < now) return "SignatureExpired";
        if (BigInt(n.dueDate) <= now) return "InvalidDueDate";
        if (activeIds.has(n.noteId)) return "NoteAlreadyExists";
        if (usedDocs.has(n.docHash)) return "DocHashAlreadyUsed";
        return null;
      };
      const tryOrRun = async (label, err, staticFn, sendFn, apply) => {
        if (err) {
          await expect(staticFn(), `${label}: harus revert ${err}`).to.be.revertedWithCustomError(manager, err);
          return "✗";
        }
        await time.setNextBlockTimestamp((await time.latest()) + 1);
        await sendFn();
        apply();
        return "";
      };

      for (let step = 0; step < STEPS; step++) {
        const p = rng.pick(pool);
        const n = p.note;
        const op = rng.weighted([
          ["deposit", 5],
          ["refund", 3],
          ["activate", 5],
          ["cancel", 2],
          ["jump", 2],
          ["intruder", 2],
        ]);
        const now = BigInt(await time.latest()) + 1n; // perkiraan timestamp eksekusi
        const label = `seed ${seed} langkah ${step} [${op}]`;

        if (op === "jump") {
          // jangan mendarat ±60 detik dari deadline mana pun (batas tepat diuji di file 05)
          let target = Number(now) + rng.int(1, 3 * DAY);
          while (pool.some((q) => Math.abs(Number(q.note.deadline) - target) < 60)) target += 120;
          await time.increaseTo(target);
        } else if (op === "deposit") {
          let err = n.disbursement !== 0 ? "WrongDisbursement" : validateNew(p, now);
          if (!err && used.has(key(n.creditor, n.creditorNonce))) err = "NonceAlreadyUsed";
          if (!err && escrow.get(p.hash)) err = "EscrowAlreadyDeposited";
          await tryOrRun(
            label,
            err,
            () => manager.connect(relayer).depositEscrow.staticCall(n, p.sigC, NO_PERMIT),
            () => manager.connect(relayer).depositEscrow(n, p.sigC, NO_PERMIT),
            () => {
              escrow.set(p.hash, n.principal);
              book.move(n.creditor, manager.target, n.principal);
            }
          );
        } else if (op === "refund") {
          const err = escrow.get(p.hash) ? null : "EscrowMissing";
          await tryOrRun(
            label,
            err,
            () => manager.connect(p.creditor).refundEscrow.staticCall(n),
            () => manager.connect(p.creditor).refundEscrow(n),
            () => {
              escrow.delete(p.hash);
              used.add(key(n.creditor, n.creditorNonce)); // refund ikut membatalkan signature kreditur
              book.move(manager.target, n.creditor, n.principal);
            }
          );
        } else if (op === "activate") {
          let err = validateNew(p, now);
          if (n.disbursement === 0) {
            if (!err && escrow.get(p.hash) !== n.principal) err = "EscrowMissing";
            if (!err && used.has(key(n.creditor, n.creditorNonce))) err = "NonceAlreadyUsed";
            if (!err && used.has(key(n.debtor, n.debtorNonce))) err = "NonceAlreadyUsed";
            await tryOrRun(
              label,
              err,
              () => manager.connect(relayer).activateOnchain.staticCall(n, p.schedule, p.sigC, p.sigD),
              () => manager.connect(relayer).activateOnchain(n, p.schedule, p.sigC, p.sigD),
              () => {
                escrow.delete(p.hash);
                used.add(key(n.creditor, n.creditorNonce)).add(key(n.debtor, n.debtorNonce));
                activeIds.add(n.noteId);
                usedDocs.add(n.docHash);
                book.move(manager.target, n.debtor, n.principal);
              }
            );
          } else {
            const receipt = { noteHash: p.hash, proofHash: nextId("race-r"), amount: n.principal, nonce: nextNonce(), deadline: n.deadline };
            const sigR = await p.debtor.signTypedData(ctx.domain, E.RECEIPT_TYPES, receipt);
            if (!err && used.has(key(n.creditor, n.creditorNonce))) err = "NonceAlreadyUsed";
            if (!err && used.has(key(n.debtor, n.debtorNonce))) err = "NonceAlreadyUsed";
            await tryOrRun(
              label,
              err,
              () => manager.connect(relayer).activateOffchain.staticCall(n, p.schedule, p.sigC, p.sigD, receipt, sigR),
              () => manager.connect(relayer).activateOffchain(n, p.schedule, p.sigC, p.sigD, receipt, sigR),
              () => {
                used.add(key(n.creditor, n.creditorNonce)).add(key(n.debtor, n.debtorNonce)).add(key(n.debtor, receipt.nonce));
                activeIds.add(n.noteId);
                usedDocs.add(n.docHash);
              }
            );
          }
        } else if (op === "cancel") {
          const [who, nonce] = rng.chance(0.5) ? [p.creditor, n.creditorNonce] : [p.debtor, n.debtorNonce];
          const err = used.has(key(who.address, nonce)) ? "NonceAlreadyUsed" : null;
          await tryOrRun(
            label,
            err,
            () => manager.connect(who).cancelNonce.staticCall(nonce),
            () => manager.connect(who).cancelNonce(nonce),
            () => used.add(key(who.address, nonce))
          );
        } else if (op === "intruder") {
          // pihak luar mencoba menarik escrow orang lain, atau debitur yang mencoba
          const who = rng.pick([stranger, p.debtor]);
          await expect(manager.connect(who).refundEscrow.staticCall(n), label).to.be.revertedWithCustomError(manager, "NotCreditor");
        }

        // invarian setelah setiap aksi
        let held = 0n;
        for (const q of pool) {
          const want = escrow.get(q.hash) ?? 0n;
          held += want;
          expect(await manager.escrowOf(q.hash), `${label}: escrowOf`).to.equal(want);
          expect(await manager.nonceUsed(q.note.creditor, q.note.creditorNonce), `${label}: nonce kreditur`).to.equal(
            used.has(key(q.note.creditor, q.note.creditorNonce))
          );
          expect(await manager.nonceUsed(q.note.debtor, q.note.debtorNonce), `${label}: nonce debitur`).to.equal(
            used.has(key(q.note.debtor, q.note.debtorNonce))
          );
          expect(await manager.statusOf(q.note.noteId) !== 0n, `${label}: aktif?`).to.equal(activeIds.has(q.note.noteId));
        }
        expect(await idrx.balanceOf(manager.target), `${label}: saldo kontrak = Σ escrow`).to.equal(held);
        await book.check(idrx, label);
      }

      // Semua escrow yang tersisa harus bisa ditarik, walau deadline sudah lewat lama.
      await time.increase(30 * DAY);
      for (const q of pool) {
        if (!escrow.get(q.hash)) continue;
        await manager.connect(q.creditor).refundEscrow(q.note);
        book.move(manager.target, q.note.creditor, q.note.principal);
        escrow.delete(q.hash);
      }
      expect(await idrx.balanceOf(manager.target), "semua escrow kembali").to.equal(0n);
      await book.check(idrx, `seed ${seed} akhir`);
    });
  }
});
