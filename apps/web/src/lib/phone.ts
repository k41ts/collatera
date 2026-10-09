/** Normalisasi nomor HP Indonesia ke format +628…: "0812-3456 7890", "62812…", "+62 812…" jadi "+628123456789".
 *  Mengembalikan null jika bukan nomor seluler Indonesia yang valid. */
export function normalizePhone(raw: string): string | null {
  let p = raw.replace(/[\s().-]/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  if (p.startsWith("0")) p = "62" + p.slice(1);
  else if (p.startsWith("8")) p = "62" + p;
  return /^628\d{7,11}$/.test(p) ? "+" + p : null;
}
