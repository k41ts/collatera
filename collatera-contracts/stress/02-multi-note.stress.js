// FUZZ 2: banyak piutang hidup bersamaan antar 8 pihak.
//
// Satu pihak bisa menjadi kreditur di satu piutang dan debitur di piutang lain (peran per piutang, BR-03).
// Aksi acak diselang-seling lintas piutang. Yang dibuktikan:
//   - isolasi: aksi pada satu piutang tidak mengubah angka piutang lain (semua piutang dicek berkala vs model);
//   - konservasi token: total saldo semua pihak + kontrak tidak berubah, dan kontrak tidak pernah menahan dana;
//   - kepemilikan NFT: jumlah token tiap pihak = jumlah piutang aktif di mana ia kreditur.
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { time, expect, S, prng, deployStress, randomSchedule, openNote, expectMatches, SEEDS, STEPS, BASE_SEED, IDR } = require("./lib/setup");
const { Ledger, randomAction } = require("./lib/actions");

const PARTIES = 8;
const LIVE_NOTES = 10;
const fixture = () => deployStress(PARTIES);

describe("STRESS 2 · banyak piutang bersamaan, peran bergantian, isolasi & konservasi dana", function () {
  this.timeout(0);
  const seeds = Math.max(1, Math.ceil(SEEDS / 4));

  for (let i = 0; i < seeds; i++) {
    const seed = BASE_SEED + 1000 + i;
    it(`seed ${seed}: ${LIVE_NOTES} piutang hidup, ${STEPS * 3} aksi acak lintas piutang`, async () => {
      const ctx = await loadFixture(fixture);
      const rng = prng(seed);
      const { parties, idrx, manager, debtNote } = ctx;
      const everyone = [...parties.map((p) => p.address), manager.target];
      const book = new Ledger();
      await book.init(idrx, everyone);
      const supply = await idrx.totalSupply();

      const fresh = async () => {
        const a = rng.int(0, PARTIES - 1);
        let b = rng.int(0, PARTIES - 2);
        if (b >= a) b++;
        const now = await time.latest();
        const e = await openNote(ctx, {
          creditor: parties[a],
          debtor: parties[b],
          schedule: randomSchedule(rng, now + 60, { maxN: rng.int(1, 12), maxAmount: IDR(2_000_000) }),
          lateFeeBps: rng.chance(0.8) ? 200 : 0,
          offchain: rng.chance(0.3),
        });
        // Pencairan on-chain: pokok berpindah kreditur → escrow → debitur. Off-chain: tidak ada token bergerak.
        if (e.note.disbursement === 0) book.move(e.model.creditor.address, e.model.debtor.address, e.note.principal);
        return e;
      };
      const notes = [];
      for (let k = 0; k < LIVE_NOTES; k++) notes.push(await fresh());

      const checkAll = async (label) => {
        for (const [k, e] of notes.entries()) await expectMatches(ctx, e.model, `${label} piutang#${k}`);
        await book.check(idrx, label);
        expect(await idrx.totalSupply(), `${label}: supply token tetap`).to.equal(supply);
        expect(await idrx.balanceOf(manager.target), `${label}: kontrak tidak menahan dana`).to.equal(0n);
        let sum = 0n;
        for (const a of everyone) sum += await idrx.balanceOf(a);
        expect(sum, `${label}: total saldo semua pihak konstan`).to.equal(supply);
        for (const p of parties) {
          const live = notes.filter((e) => e.model.creditor.address === p.address && e.model.status !== S.PAID).length;
          expect(await debtNote.balanceOf(p.address), `${label}: jumlah NFT ${p.address}`).to.equal(BigInt(live));
        }
      };
      await checkAll(`seed ${seed} awal`);

      for (let step = 0; step < STEPS * 3; step++) {
        const k = rng.int(0, notes.length - 1);
        const label = `seed ${seed} langkah ${step} piutang#${k}`;
        const done = await randomAction(ctx, rng, notes[k], book, label);
        await expectMatches(ctx, notes[k].model, `${label} [${done}]`);
        if (step % 15 === 14) await checkAll(`seed ${seed} langkah ${step}`);
        if (notes[k].model.status === S.PAID) {
          await checkAll(`seed ${seed} sebelum ganti piutang#${k}`); // token PAID sudah di-burn
          notes[k] = await fresh();
        }
      }
      await checkAll(`seed ${seed} akhir`);
    });
  }
});
