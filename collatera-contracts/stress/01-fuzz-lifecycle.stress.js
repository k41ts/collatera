// FUZZ 1: siklus hidup satu piutang dengan urutan aksi acak.
//
// Untuk setiap seed: jadwal acak (1–24 cicilan, nominal 0,01 s.d. Rp5 juta), denda 0% atau 2%, pencairan on-chain atau
// off-chain, lalu STRESS_STEPS aksi acak: lompat waktu (termasuk tepat di detik jatuh tempo ±1), bayar on-chain/off-chain
// dengan nominal "menjebak" (0, 1 satuan, tepat tunggakan, tepat sisa, lebih), dispute, freeze, revisi, tandai lunas,
// dan percobaan aksi oleh pihak tak berhak. Setelah SETIAP aksi, kontrak dibandingkan dengan model bayangan sampai
// satuan terkecil, dan saldo semua pihak dicek. Di akhir, piutang harus selalu bisa dilunasi sampai PAID.
//
// Ulangi seed yang gagal:  STRESS_SEED=<seed> STRESS_SEEDS=1 npm run test:stress
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { time, expect, S, prng, deployStress, randomSchedule, openNote, expectMatches, SEEDS, STEPS, BASE_SEED, IDR } = require("./lib/setup");
const { Ledger, randomAction, settle } = require("./lib/actions");

const fixture = () => deployStress(6);

describe("STRESS 1 · fuzz siklus hidup satu piutang (kontrak vs model bayangan)", function () {
  this.timeout(0);
  const stats = {};

  for (let i = 0; i < SEEDS; i++) {
    const seed = BASE_SEED + i;
    it(`seed ${seed}: ${STEPS} aksi acak tetap konsisten dengan model`, async () => {
      const ctx = await loadFixture(fixture);
      const rng = prng(seed);
      const [creditor, debtor] = [ctx.parties[rng.int(0, 2)], ctx.parties[rng.int(3, 5)]];
      const book = new Ledger();
      await book.init(ctx.idrx, [creditor.address, debtor.address, ctx.manager.target]);

      // Piutang baru setiap kali yang lama lunas, supaya semua langkah menguji piutang yang masih hidup.
      const fresh = async () => {
        const now = await time.latest();
        const schedule = randomSchedule(rng, now + 60, {
          maxN: rng.pick([1, 3, 12, 24]),
          maxAmount: rng.pick([100n, IDR(10_000), IDR(5_000_000)]),
        });
        const e = await openNote(ctx, {
          creditor,
          debtor,
          schedule,
          lateFeeBps: rng.chance(0.85) ? 200 : 0,
          offchain: rng.chance(0.3),
        });
        // Pencairan on-chain: pokok berpindah kreditur → escrow → debitur. Off-chain: tidak ada token bergerak.
        if (e.note.disbursement === 0) book.move(e.model.creditor.address, e.model.debtor.address, e.note.principal);
        await expectMatches(ctx, e.model, `seed ${seed} piutang baru`);
        stats.piutang = (stats.piutang || 0) + 1;
        return e;
      };
      let entry = await fresh();

      for (let step = 0; step < STEPS; step++) {
        const label = `seed ${seed} langkah ${step}`;
        const done = await randomAction(ctx, rng, entry, book, label);
        stats[done] = (stats[done] || 0) + 1;
        await expectMatches(ctx, entry.model, `${label} [${done}]`);
        await book.check(ctx.idrx, `${label} [${done}]`);
        if (entry.model.status === S.PAID && step < STEPS - 1) entry = await fresh();
      }

      await settle(ctx, entry, book, `seed ${seed} pelunasan`);
      await expectMatches(ctx, entry.model, `seed ${seed} akhir`);
      await book.check(ctx.idrx, `seed ${seed} akhir`);
      expect(await ctx.idrx.balanceOf(ctx.manager.target), "tidak ada dana tersangkut di kontrak").to.equal(0n);
    });
  }

  after(() => {
    const line = Object.entries(stats)
      .sort()
      .map(([k, v]) => `${k}=${v}`)
      .join("  ");
    console.log(`      distribusi aksi (✗ = diharapkan revert): ${line}`);
  });
});
