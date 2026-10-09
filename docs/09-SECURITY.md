# 09 — Security

## Threat Model

| Ancaman | Dampak | Mitigasi |
|---------|--------|----------|
| Replay signature EIP-712 | Mint ganda / tanda tangan dipakai ulang | `nonce` per signer, `chainId`, `deadline`, nonce di-consume di contract |
| Double-mint dokumen sama | Satu piutang jadi dua token | `mapping(bytes32 => bool) usedDocHash` di contract + unique index DB |
| Data DB diubah setelah tanda tangan | Isi perjanjian dipalsukan | Integrity checker: hash ulang vs on-chain → TAMPERED → FROZEN |
| Akses piutang orang lain (IDOR) | Bocor data pribadi | Otorisasi per piutang di setiap endpoint, RLS di Postgres |
| Signature lama tetap berlaku setelah revisi | Pihak terikat ke isi yang salah | Versi baru = `version` & `termsHash` baru, signature lama `is_valid=false` |
| Private key relayer bocor | Tx palsu atas nama sistem | Secret manager, role terbatas di contract, saldo relayer minimal, rotasi key |
| Upload file berbahaya | XSS / malware | Validasi MIME + magic bytes, maks 10 MB, simpan privat, signed URL singkat |
| Penyalahgunaan admin | Isi perjanjian diubah | Admin tidak punya fungsi edit; semua aksi admin masuk audit log |
| Event diproses dua kali | Saldo terpotong ganda | Idempotency `(txHash, logIndex)` unik |
| Reentrancy di repay/escrow | Dana terkuras | `ReentrancyGuard`, checks-effects-interactions, SafeERC20 |
| Phishing SIWE | Login palsu | Validasi `domain`, `uri`, `chainId`, nonce sekali pakai |
| Brute force OTP | Ambil alih HP | Rate limit 5x/jam, OTP 6 digit, kedaluwarsa 5 menit |

## Smart Contract

- OpenZeppelin v5: `ERC721`, `EIP712`, `AccessControl`, `ReentrancyGuard`, `Pausable`.
- Transfer token diblokir (override `_update`, kecuali mint dan burn).
- Fungsi admin dibatasi role; `DEFAULT_ADMIN_ROLE` dipegang multisig.
- Unit test Hardhat (Mocha + ethers) + test dengan input acak + coverage ≥ 90% sebelum deploy.
- Static analysis: Slither, tanpa temuan high/medium terbuka.

## Backend

- Session JWT httpOnly, `SameSite=Lax`, `Secure`, umur 24 jam.
- Validasi input dengan Zod di frontend dan backend; validasi ulang di contract.
- Rate limit per IP dan per wallet.
- CORS hanya untuk domain frontend.
- Header keamanan: CSP, HSTS, X-Content-Type-Options.

## Data Pribadi (UU PDP)

- Nama, email, HP, dan dokumen **tidak pernah** masuk blockchain atau payload EIP-712.
- Dokumen dienkripsi saat disimpan (AES-256), akses lewat signed URL ≤ 5 menit.
- Log aplikasi tidak menyimpan nomor HP atau isi dokumen.
- User bisa meminta penghapusan data pribadi; hash on-chain tetap ada tapi tidak bisa dibalik ke data.

## Secret Management

| Secret | Disimpan di |
|--------|-------------|
| `RELAYER_PRIVATE_KEY` | Secret manager platform deploy, bukan `.env` di repo |
| `JWT_SECRET`, `STORAGE_ENC_KEY` | Secret manager |
| API key (RPC, Resend, OTP, Privy) | Secret manager |

`.env*` masuk `.gitignore`; gunakan `.env.example` tanpa nilai asli.
