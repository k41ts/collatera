// Fee aplikasi yang dibayar debitur di setiap pembayaran on-chain (default 1% = 100 bps).
// Bagian ini murni hitungan, dipakai di browser maupun server. Konfigurasi env ada di appFeeConfig.ts (server).

/** Fee untuk `units` (satuan terkecil IDRX), dibulatkan ke atas supaya tidak pernah kurang dari tarifnya. */
export const feeFor = (units: bigint, bps: number) => (bps > 0 ? (units * BigInt(bps) + BigInt(9999)) / BigInt(10000) : BigInt(0));

/** "1%" / "0,5%" untuk tampilan. */
export const feeLabel = (bps: number) => `${(bps / 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;
