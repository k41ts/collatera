// Tagihan yang boleh dibayar debitur SAAT INI (dipakai di halaman bayar dan divalidasi ulang di server).
//  - Ada tunggakan / bunga keterlambatan: wajib bayar seluruh tunggakan + bunga berjalan.
//  - Tidak ada tunggakan: tepat satu cicilan berikutnya (sisa yang belum terbayar). Boleh dibayar kapan saja
//    sebelum jatuh tempo; setelah lunas, cicilan sesudahnya langsung bisa dibayar.
// Nominal tidak bisa diketik sendiri. Bunga keterlambatan bertambah per detik di kontrak, jadi untuk tunggakan
// ditambah penyangga 10 menit; bagian yang tidak terpakai otomatis masuk ke cicilan berikutnya.
import { DECIMALS } from "./chain/config";

const UNIT = BigInt(10) ** BigInt(DECIMALS);
const BPS = BigInt(10_000);
const LATE_FEE_PERIOD = BigInt(30 * 86_400);
export const FEE_BUFFER_SECONDS = 600;

export type DueInput = {
  /** Nominal tiap cicilan sesuai jadwal (satuan terkecil), urut dari cicilan pertama. */
  installments: bigint[];
  scheduledPaid: bigint;
  overdue: bigint;
  lateFee: bigint;
  lateFeeBps: number;
};

export type AmountDue = {
  kind: "overdue" | "next" | "none";
  /** Nominal yang dikirim sebagai `amount` ke payOnchain. */
  amount: bigint;
  /** Tunggakan + bunga saat ini (tanpa penyangga). */
  base: bigint;
  buffer: bigint;
  /** Nomor cicilan pertama yang belum lunas. */
  seq: number;
};

const ceilUnit = (x: bigint) => ((x + UNIT - BigInt(1)) / UNIT) * UNIT;

/** Bunga keterlambatan yang bertambah selama `FEE_BUFFER_SECONDS` atas tunggakan `overdue`, dibulatkan ke atas per Rp1. */
export function feeBuffer(overdue: bigint, lateFeeBps: number) {
  if (overdue <= BigInt(0) || lateFeeBps <= 0) return BigInt(0);
  return ceilUnit((overdue * BigInt(lateFeeBps) * BigInt(FEE_BUFFER_SECONDS) + BPS * LATE_FEE_PERIOD - BigInt(1)) / (BPS * LATE_FEE_PERIOD));
}

export function amountDue(p: DueInput): AmountDue {
  let cum = BigInt(0);
  let seq = 0;
  let next = BigInt(0);
  for (let i = 0; i < p.installments.length; i++) {
    cum += p.installments[i];
    if (cum > p.scheduledPaid) {
      seq = i + 1;
      next = cum - p.scheduledPaid;
      break;
    }
  }
  if (p.overdue > BigInt(0) || p.lateFee > BigInt(0)) {
    const base = p.overdue + p.lateFee;
    const buffer = feeBuffer(p.overdue, p.lateFeeBps);
    return { kind: "overdue", amount: base + buffer, base, buffer, seq: seq || p.installments.length };
  }
  if (!seq) return { kind: "none", amount: BigInt(0), base: BigInt(0), buffer: BigInt(0), seq: 0 };
  return { kind: "next", amount: next, base: next, buffer: BigInt(0), seq };
}
