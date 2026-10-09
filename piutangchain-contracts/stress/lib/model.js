// Model bayangan (shadow model) DebtManager untuk SATU piutang yang sudah aktif.
// Ditulis ulang dari spesifikasi (BR-19, BR-21, BR-21a) dengan BigInt, TANPA membaca state kontrak.
// Setiap langkah stress test dijalankan di kontrak dan di model, lalu hasilnya harus sama persis
// sampai satuan terkecil: sisa utang, denda, tunggakan, status, dan alokasi pembayaran.

const BPS = 10_000n;
const PERIOD = 30n * 86_400n; // 30 hari
const DENOM = BPS * PERIOD;

// urutan enum Status di kontrak
const S = { NONE: 0, ACTIVE: 1, OVERDUE: 2, PAID: 3, DISPUTED: 4, FROZEN: 5 };

class NoteModel {
  constructor({ noteId, creditor, debtor, principal, dueDates, amounts, lateFeeBps, activatedAt }) {
    this.noteId = noteId;
    this.creditor = creditor;
    this.debtor = debtor;
    this.principal = BigInt(principal);
    this.version = 1;
    this.setSchedule(dueDates, amounts);
    this.bps = BigInt(lateFeeBps);
    this.status = S.ACTIVE; // status tersimpan (tidak pernah OVERDUE)
    this.statusBeforeFreeze = S.NONE;
    this.fullyPaid = false;
    this.last = BigInt(activatedAt);
    this.scheduledPaid = 0n;
    this.lateFeeAccrued = 0n;
    this.feeRemainder = 0n;
    this.paid = 0n;
    this.feePaid = 0n;
  }

  setSchedule(dueDates, amounts) {
    this.dueDates = dueDates.map(BigInt);
    this.amounts = amounts.map(BigInt);
    this.totalOwed = this.amounts.reduce((a, b) => a + b, 0n);
  }

  // ------------------------------------------------------------ hitungan murni (tidak mengubah state)

  /** Jumlah cicilan yang jatuh temponya sudah lewat pada waktu t (dueDate < t). */
  dueBefore(t) {
    t = BigInt(t);
    let cum = 0n;
    for (let i = 0; i < this.dueDates.length; i++) {
      if (this.dueDates[i] >= t) break;
      cum += this.amounts[i];
    }
    return cum;
  }

  arrears(t) {
    if (this.fullyPaid) return 0n; // T1: setelah lunas/markPaid view menunjuk nol
    const due = this.dueBefore(t);
    return due > this.scheduledPaid ? due - this.scheduledPaid : 0n;
  }

  /** Denda sejak checkpoint: Σ tunggakan_segmen × detik × bps / (10.000 × 30 hari), sisa pembagian dibawa. */
  pending(t) {
    t = BigInt(t);
    const rem = this.feeRemainder;
    if (this.bps === 0n || this.status !== S.ACTIVE) return { fee: 0n, rem };
    let seg = this.last;
    if (t <= seg) return { fee: 0n, rem };
    let cum = 0n;
    let weighted = 0n;
    for (let i = 0; i < this.dueDates.length; i++) {
      const d = this.dueDates[i];
      if (d >= t) break;
      if (d > seg) {
        if (cum > this.scheduledPaid) weighted += (cum - this.scheduledPaid) * (d - seg);
        seg = d;
      }
      cum += this.amounts[i];
    }
    if (cum > this.scheduledPaid) weighted += (cum - this.scheduledPaid) * (t - seg);
    const num = weighted * this.bps + rem;
    return { fee: num / DENOM, rem: num % DENOM };
  }

  lateFee(t) {
    if (this.fullyPaid) return 0n; // T1
    return this.lateFeeAccrued + this.pending(t).fee;
  }

  outstanding(t) {
    if (this.fullyPaid) return 0n;
    return this.totalOwed - this.scheduledPaid + this.lateFee(t);
  }

  viewStatus(t) {
    if (this.status === S.ACTIVE && !this.fullyPaid && (this.arrears(t) > 0n || this.lateFee(t) > 0n)) return S.OVERDUE;
    return this.status;
  }

  // ------------------------------------------------------------ transisi (meniru urutan cek di kontrak)

  accrue(t) {
    const { fee, rem } = this.pending(t);
    this.last = BigInt(t);
    this.feeRemainder = rem;
    this.lateFeeAccrued += fee;
  }

  /** Nama error yang diharapkan, atau null jika pembayaran sah. */
  payError(amount, onchain, t) {
    amount = BigInt(amount);
    if (onchain) {
      if (this.status !== S.ACTIVE && this.status !== S.DISPUTED) return "InvalidStatus";
    } else if (this.status !== S.ACTIVE) return "InvalidStatus";
    if (this.fullyPaid) return "AlreadyFullyPaid";
    if (amount === 0n) return "InvalidAmount";
    if (!onchain && amount > this.outstanding(t)) return "Overpayment";
    return null;
  }

  /** Terapkan pembayaran. Mengembalikan { amount (yang benar-benar dibayar), toFee }. */
  pay(amount, onchain, t) {
    amount = BigInt(amount);
    const err = this.payError(amount, onchain, t);
    if (err) throw new Error(`model: pembayaran seharusnya revert ${err}`);
    this.accrue(t);
    const left = this.outstanding(t);
    if (amount > left) amount = left; // on-chain: dipotong ke sisa utang
    const arrears = this.arrears(t);
    let toSched = amount < arrears ? amount : arrears;
    const rest = amount - toSched;
    const toFee = rest < this.lateFeeAccrued ? rest : this.lateFeeAccrued;
    toSched += rest - toFee;
    this.scheduledPaid += toSched;
    this.lateFeeAccrued -= toFee;
    this.paid += amount;
    this.feePaid += toFee;
    if (amount === left) {
      this.fullyPaid = true;
      if (this.status === S.ACTIVE) this.status = S.PAID;
    }
    return { amount, toFee, left };
  }

  openDisputeError() {
    return this.status === S.ACTIVE ? null : "InvalidStatus";
  }
  openDispute(t) {
    this.accrue(t);
    this.status = S.DISPUTED;
  }

  closeDisputeError() {
    return this.status === S.DISPUTED ? null : "InvalidStatus";
  }
  closeDispute(t) {
    this.accrue(t);
    this.status = S.ACTIVE;
    if (this.fullyPaid) this.status = S.PAID;
  }

  freezeError() {
    return this.status === S.ACTIVE || this.status === S.DISPUTED ? null : "InvalidStatus";
  }
  freeze(t) {
    this.accrue(t);
    this.statusBeforeFreeze = this.status;
    this.status = S.FROZEN;
  }

  unfreezeError() {
    return this.status === S.FROZEN ? null : "InvalidStatus";
  }
  unfreeze(t) {
    this.accrue(t);
    this.status = this.statusBeforeFreeze;
    if (this.status === S.ACTIVE && this.fullyPaid) this.status = S.PAID;
  }

  markPaidError() {
    return this.status === S.ACTIVE ? null : "InvalidStatus";
  }
  markPaid(t) {
    this.accrue(t);
    const waived = this.outstanding(t);
    this.fullyPaid = true;
    this.status = S.PAID;
    return waived;
  }

  amendError() {
    return this.status === S.ACTIVE || this.status === S.DISPUTED ? null : "InvalidStatus";
  }
  amend(t, { dueDates, amounts, lateFeeBps }) {
    this.accrue(t);
    this.version += 1;
    this.setSchedule(dueDates, amounts);
    this.bps = BigInt(lateFeeBps);
    if (this.scheduledPaid > this.totalOwed) this.scheduledPaid = this.totalOwed;
    this.fullyPaid = this.scheduledPaid === this.totalOwed && this.lateFeeAccrued === 0n;
    if (this.fullyPaid && this.status === S.ACTIVE) this.status = S.PAID;
  }
}

module.exports = { NoteModel, S, BPS, PERIOD, DENOM };
