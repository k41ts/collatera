// Konfigurasi fee aplikasi dari env (SERVER SAJA).
//   APP_FEE_WALLET : alamat wallet penampung fee. Kosong = fee nonaktif.
//   APP_FEE_BPS    : tarif dalam basis poin, 100 = 1% (default). Maksimal 1000 (10%).
import { getAddress, isAddress } from "ethers";

export type AppFee = { wallet: string; bps: number };

export function appFeeConfig(): AppFee | null {
  const w = process.env.APP_FEE_WALLET?.trim();
  if (!w) return null;
  if (!isAddress(w)) throw new Error("APP_FEE_WALLET di .env bukan alamat wallet yang valid (0x… 42 karakter).");
  const bps = Number(process.env.APP_FEE_BPS?.trim() || "100");
  if (!Number.isInteger(bps) || bps < 0 || bps > 1000) throw new Error("APP_FEE_BPS di .env harus bilangan bulat 0–1000 (100 = 1%).");
  return bps === 0 ? null : { wallet: getAddress(w), bps };
}
