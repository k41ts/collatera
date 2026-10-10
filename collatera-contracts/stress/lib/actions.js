// Mesin aksi acak untuk fuzzing: memilih aksi, memprediksi hasilnya dengan model, menjalankannya di kontrak,
// lalu membandingkan. Aksi yang menurut model harus gagal dicoba lewat staticCall (tidak menambang blok)
// dan harus revert dengan error yang sama.
const { ethers, time, expect, E, S, IDR, DAY, NO_PERMIT, signPayment, nextId, nextNonce } = require("./setup");

const REASON = ethers.id("stress-reason");

/** Buku saldo yang diharapkan: alamat → saldo MockIDRX. */
class Ledger {
  constructor() {
    this.map = new Map();
  }
  async init(idrx, addrs) {
    for (const a of addrs) this.map.set(a, await idrx.balanceOf(a));
  }
  move(from, to, amount) {
    this.map.set(from, this.map.get(from) - amount);
    this.map.set(to, this.map.get(to) + amount);
  }
  async check(idrx, label) {
    for (const [a, bal] of this.map) expect(await idrx.balanceOf(a), `${label}: saldo ${a}`).to.equal(bal);
  }
}

async function nextTs(rng) {
  return (await time.latest()) + rng.int(1, 5);
}

async function expectRevert(promise, ctx, err, label) {
  await expect(promise, `${label}: harus revert ${err}`).to.be.revertedWithCustomError(ctx.manager, err);
}

function findEvent(ctx, receipt, name) {
  for (const log of receipt.logs) {
    try {
      const parsed = ctx.manager.interface.parseLog(log);
      if (parsed && parsed.name === name) return parsed;
    } catch {}
  }
  return null;
}

/** Pilih nominal pembayaran yang "menarik": tepat tunggakan, tepat sisa, kelebihan, 1 satuan, 0, acak. */
function pickAmount(rng, m, t, onchain) {
  const out = m.outstanding(t);
  const arr = m.arrears(t);
  const fee = m.lateFee(t);
  const opts = [
    [1n, 2],
    [arr, 3],
    [arr + fee, 3],
    [out, 1],
    [out > 1n ? rng.big(1n, out / 3n > 1n ? out / 3n : 1n) : 1n, 6],
    [0n, 1],
  ];
  if (onchain) opts.push([out + rng.big(1n, IDR(1_000_000)), 1]);
  else opts.push([out + IDR(1_000) + rng.big(0n, IDR(1_000)), 1]); // pasti melebihi sisa walau denda berjalan
  const v = rng.weighted(opts);
  return v < 0n ? 0n : v;
}

/** Satu aksi acak terhadap satu piutang. `book` dicek setelahnya oleh pemanggil. */
async function randomAction(ctx, rng, entry, book, label) {
  const m = entry.model;
  const { manager, admin, freezer, relayer, stranger } = ctx;
  const action = rng.weighted([
    ["jump", 22],
    ["payOn", 22],
    ["payOff", 10],
    ["dispute", 7],
    ["close", 7],
    ["freeze", 5],
    ["unfreeze", 6],
    ["accrue", 5],
    ["markPaid", 1],
    ["amend", 5],
    ["intruder", 6],
  ]);
  const t = BigInt(await time.latest());
  const tag = `${label} [${action}]`;

  switch (action) {
    case "jump": {
      const next = m.dueDates.find((d) => d > t);
      const targets = [t + BigInt(rng.int(1, 3600)), t + BigInt(rng.int(1, 40) * DAY)];
      if (next !== undefined) targets.push(next - 1n, next, next + 1n, next + BigInt(rng.int(1, 20) * DAY));
      const target = rng.pick(targets.filter((x) => x > t));
      await time.increaseTo(target);
      return action;
    }

    case "payOn": {
      const ts = await nextTs(rng);
      const amount = pickAmount(rng, m, ts, true);
      const err = m.payError(amount, true, ts);
      const call = () => manager.connect(m.debtor).payOnchain(m.noteId, amount, 0, NO_PERMIT);
      if (err) {
        await expectRevert(manager.connect(m.debtor).payOnchain.staticCall(m.noteId, amount, 0, NO_PERMIT), ctx, err, tag);
        return action + "✗";
      }
      await time.setNextBlockTimestamp(ts);
      const rc = await (await call()).wait();
      const r = m.pay(amount, true, ts);
      const ev = findEvent(ctx, rc, "PaymentRecorded");
      expect(ev.args.amount, `${tag}: nominal yang ditarik`).to.equal(r.amount);
      expect(ev.args.toLateFee, `${tag}: alokasi ke denda`).to.equal(r.toFee);
      expect(ev.args.remaining, `${tag}: sisa di event`).to.equal(r.left - r.amount);
      book.move(m.debtor.address, m.creditor.address, r.amount);
      return action;
    }

    case "payOff": {
      const ts = await nextTs(rng);
      const amount = pickAmount(rng, m, ts, false);
      const { c, sig } = await signPayment(ctx, m.creditor, m.noteId, amount, ts + DAY);
      const err = m.payError(amount, false, ts);
      if (err) {
        await expectRevert(manager.connect(relayer).recordOffchainPayment.staticCall(c, sig), ctx, err, tag);
        return action + "✗";
      }
      await time.setNextBlockTimestamp(ts);
      const rc = await (await manager.connect(relayer).recordOffchainPayment(c, sig)).wait();
      const r = m.pay(amount, false, ts);
      const ev = findEvent(ctx, rc, "PaymentRecorded");
      expect(ev.args.toLateFee, `${tag}: alokasi ke denda`).to.equal(r.toFee);
      return action;
    }

    case "dispute": {
      const who = rng.chance(0.5) ? m.creditor : m.debtor;
      const err = m.openDisputeError();
      if (err) {
        await expectRevert(manager.connect(who).openDispute.staticCall(m.noteId, REASON), ctx, err, tag);
        return action + "✗";
      }
      const ts = await nextTs(rng);
      await time.setNextBlockTimestamp(ts);
      await manager.connect(who).openDispute(m.noteId, REASON);
      m.openDispute(ts);
      return action;
    }

    case "close": {
      const err = m.closeDisputeError();
      if (err) {
        await expectRevert(manager.connect(admin).closeDispute.staticCall(m.noteId, REASON, false), ctx, err, tag);
        return action + "✗";
      }
      const ts = await nextTs(rng);
      const waive = rng.int(0, 1) === 1;
      await time.setNextBlockTimestamp(ts);
      await manager.connect(admin).closeDispute(m.noteId, REASON, waive);
      m.closeDispute(ts, waive);
      return action;
    }

    case "freeze": {
      const who = rng.chance(0.5) ? freezer : admin;
      const err = m.freezeError();
      if (err) {
        await expectRevert(manager.connect(who).freeze.staticCall(m.noteId, REASON), ctx, err, tag);
        return action + "✗";
      }
      const ts = await nextTs(rng);
      await time.setNextBlockTimestamp(ts);
      await manager.connect(who).freeze(m.noteId, REASON);
      m.freeze(ts);
      return action;
    }

    case "unfreeze": {
      const err = m.unfreezeError();
      if (err) {
        await expectRevert(manager.connect(admin).unfreeze.staticCall(m.noteId, REASON), ctx, err, tag);
        return action + "✗";
      }
      const ts = await nextTs(rng);
      await time.setNextBlockTimestamp(ts);
      await manager.connect(admin).unfreeze(m.noteId, REASON);
      m.unfreeze(ts);
      return action;
    }

    case "accrue": {
      const ts = await nextTs(rng);
      await time.setNextBlockTimestamp(ts);
      await manager.connect(stranger).accrue(m.noteId);
      m.accrue(ts);
      return action;
    }

    case "markPaid": {
      const err = m.markPaidError();
      if (err) {
        await expectRevert(manager.connect(m.creditor).markPaid.staticCall(m.noteId), ctx, err, tag);
        return action + "✗";
      }
      const ts = await nextTs(rng);
      await time.setNextBlockTimestamp(ts);
      await manager.connect(m.creditor).markPaid(m.noteId);
      m.markPaid(ts);
      return action;
    }

    case "amend": {
      // Jadwal baru acak, boleh memuat tanggal lampau; kadang totalnya di bawah yang sudah dibayar.
      const n = rng.int(1, 4);
      const dueDates = [];
      const amounts = [];
      let d = t - BigInt(rng.int(0, 60) * DAY);
      for (let i = 0; i < n; i++) {
        d += BigInt(rng.int(1, 30) * DAY);
        dueDates.push(d);
        amounts.push(rng.big(1n, IDR(3_000_000)));
      }
      if (rng.chance(0.2) && m.scheduledPaid > 1n) {
        amounts.length = 1;
        dueDates.length = 1;
        amounts[0] = rng.big(1n, m.scheduledPaid);
      }
      const schedule = { dueDates, amounts };
      const lateFeeBps = rng.pick([0, 200]);
      const a = {
        noteId: m.noteId,
        newVersion: m.version + 1,
        newDocHash: nextId("stress-amend-doc"),
        newScheduleHash: E.scheduleHash(schedule),
        newTotalOwed: amounts.reduce((x, y) => x + y, 0n),
        newLateFeeBps: lateFeeBps,
        newDueDate: dueDates[dueDates.length - 1],
        deadline: t + BigInt(DAY),
        creditorNonce: nextNonce(),
        debtorNonce: nextNonce(),
      };
      const sigC = await m.creditor.signTypedData(ctx.domain, E.AMENDMENT_TYPES, a);
      const sigD = await m.debtor.signTypedData(ctx.domain, E.AMENDMENT_TYPES, a);
      const err = m.amendError();
      if (err) {
        await expectRevert(manager.connect(relayer).amend.staticCall(a, schedule, sigC, sigD), ctx, err, tag);
        return action + "✗";
      }
      const ts = await nextTs(rng);
      await time.setNextBlockTimestamp(ts);
      await manager.connect(relayer).amend(a, schedule, sigC, sigD);
      m.amend(ts, { dueDates, amounts, lateFeeBps });
      return action;
    }

    case "intruder": {
      // Pihak yang tidak berhak mencoba aksi terlarang: semuanya harus revert dan tidak mengubah apa pun.
      const attempt = rng.int(0, 5);
      if (attempt === 0)
        await expectRevert(manager.connect(stranger).payOnchain.staticCall(m.noteId, 1, 0, NO_PERMIT), ctx, "NotDebtor", tag);
      if (attempt === 1)
        await expectRevert(manager.connect(m.creditor).payOnchain.staticCall(m.noteId, 1, 0, NO_PERMIT), ctx, "NotDebtor", tag);
      if (attempt === 2)
        await expectRevert(manager.connect(stranger).openDispute.staticCall(m.noteId, REASON), ctx, "NotParty", tag);
      if (attempt === 3)
        await expectRevert(manager.connect(m.debtor).freeze.staticCall(m.noteId, REASON), ctx, "AccessControlUnauthorizedAccount", tag);
      if (attempt === 4)
        await expectRevert(manager.connect(freezer).unfreeze.staticCall(m.noteId, REASON), ctx, "AccessControlUnauthorizedAccount", tag);
      if (attempt === 5) {
        // konfirmasi off-chain yang ditandatangani DEBITUR (bukan kreditur)
        const { c, sig } = await signPayment(ctx, m.debtor, m.noteId, 1n, t + BigInt(DAY));
        const expected = m.status === S.ACTIVE ? "InvalidSignature" : "InvalidStatus";
        await expectRevert(manager.connect(relayer).recordOffchainPayment.staticCall(c, sig), ctx, expected, tag);
      }
      return action;
    }
  }
  throw new Error(`aksi tidak dikenal ${action}`);
}

/**
 * Liveness: dari status apa pun, piutang selalu bisa dibawa sampai PAID tanpa dana tersangkut.
 */
async function settle(ctx, entry, book, label) {
  const m = entry.model;
  const { manager, admin } = ctx;
  const go = async (fn) => {
    const ts = (await time.latest()) + 1;
    await time.setNextBlockTimestamp(ts);
    await fn();
    return ts;
  };
  if (m.status === S.FROZEN) m.unfreeze(await go(() => manager.connect(admin).unfreeze(m.noteId, REASON)));
  if (m.status === S.DISPUTED) m.closeDispute(await go(() => manager.connect(admin).closeDispute(m.noteId, REASON, false)));
  if (m.status !== S.PAID) {
    const ts = (await time.latest()) + 1;
    const amount = m.outstanding(ts) + IDR(1);
    await time.setNextBlockTimestamp(ts);
    await manager.connect(m.debtor).payOnchain(m.noteId, amount, 0, NO_PERMIT);
    const r = m.pay(amount, true, ts);
    book.move(m.debtor.address, m.creditor.address, r.amount);
  }
  expect(m.status, `${label}: harus PAID setelah dilunasi`).to.equal(S.PAID);
}

module.exports = { Ledger, randomAction, settle, REASON };
