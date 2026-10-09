import { DECIMALS } from "./chain/config";

const UNIT = BigInt(10) ** BigInt(DECIMALS);

/** "5000000" (rupiah utuh) → "500000000" (satuan terkecil). Menolak selain angka bulat positif. */
export function rupiahToUnits(rupiah: string | number): string {
  const s = String(rupiah).replace(/[^\d]/g, "");
  if (!s) throw new Error("Nominal kosong");
  return (BigInt(s) * UNIT).toString();
}

export function unitsToRupiah(units: string | bigint): bigint {
  return BigInt(units) / UNIT;
}

/** Format satuan terkecil → "Rp1.250.000" (pecahan sen dibuang untuk tampilan). */
export function fmtRp(units: string | bigint | null | undefined): string {
  if (units === null || units === undefined || units === "") return "Rp0";
  const v = BigInt(units);
  const whole = v / UNIT;
  return "Rp" + whole.toLocaleString("id-ID");
}

export function fmtRpWhole(rupiah: string | number | bigint): string {
  return "Rp" + BigInt(String(rupiah).replace(/[^\d]/g, "") || "0").toLocaleString("id-ID");
}
