# 09 — Security

## Threat Model

| Ancaman | Dampak | Mitigasi |
|---------|--------|----------|
| Replay signature EIP-712 | Mint ganda / tanda tangan dipakai ulang | Unordered nonce acak per signer (`nonceUsed[signer][nonce]`), `chainId`, `deadline`; nonce ditandai terpakai di contract; `cancelNonce` untuk membatalkan |
| Replay konfirmasi bayar off-chain | Sisa utang terpotong berkali-kali | Struct `PaymentConfirmation` berisi `proofHash` (unik per piutang), `nonce`, `deadline`; nonce kreditur ditandai terpakai di contract; `settleFull` ikut ditandatangani, jadi penghapusan sisa denda hanya terjadi atas kehendak kreditur dan dibatasi toleransi 1 hari denda |
| Signature kreditur dipakai ulang setelah refund escrow | Dana kreditur disetor ulang dan piutang yang sudah ditinggalkan jadi aktif | `refundEscrow` membatalkan `creditorNonce` |
| Debitur membuka dispute saat OVERDUE agar denda berhenti | Denda terhindar tanpa batas waktu; hanya admin yang bisa menutup | Denda tetap berjalan saat DISPUTED; `closeDispute(..., waiveFee)` bisa menghapus porsi dispute; `closeExpiredDispute` bisa dipanggil siapa pun setelah `DISPUTE_WINDOW` 14 hari |
| Denda dihapus dengan memanggil `accrue()` tiap blok | Denda kecil selalu dibulatkan ke 0 | Sisa pembulatan disimpan di `feeRemainder` dan dibawa ke checkpoint berikutnya |
| Relayer memberi gas kurang ke forwarder | Permit di dalam try/catch sengaja dibuat gagal | `PiutangForwarder` membatalkan seluruh tx jika gas tersisa < `req.gas / 63` |
| Double-mint dokumen sama | Satu piutang jadi dua token | `mapping(bytes32 => bool) usedDocHash` di contract + unique index `debt_notes.minted_doc_hash` di DB |
| Data DB diubah setelah tanda tangan | Isi perjanjian dipalsukan | Integrity checker: hash ulang vs on-chain → TAMPERED → FROZEN |
| Akses piutang orang lain (IDOR) | Bocor data pribadi | Otorisasi per piutang di setiap endpoint, RLS di Postgres |
| Signature lama tetap berlaku setelah revisi | Pihak terikat ke isi yang salah | Versi baru = `version` & struct hash `Note` baru, signature lama `is_valid=false`, nonce lama dibatalkan (`cancelNonce` / `refundEscrow`) |
| Private key relayer bocor | Tx palsu atas nama sistem | Secret manager, role terbatas di contract, saldo relayer minimal, rotasi key |
| Upload file berbahaya | XSS / malware | Validasi MIME + magic bytes, maks 10 MB, simpan privat, signed URL singkat |
| Penyalahgunaan admin | Isi perjanjian diubah | Admin tidak punya fungsi edit; semua aksi admin masuk audit log |
| Event diproses dua kali | Saldo terpotong ganda | Idempotency `(txHash, logIndex)` unik |
| Reentrancy di pembayaran/escrow | Dana terkuras | `ReentrancyGuard`, checks-effects-interactions, `TransferHelper` (aman untuk token tanpa return value), cek saldo masuk (tolak fee-on-transfer) |
| Phishing SIWE | Login palsu | Validasi `domain`, `uri`, `chainId`, nonce sekali pakai |
| Brute force OTP | Ambil alih HP | Rate limit 5x/jam, OTP 6 digit, kedaluwarsa 5 menit |

## Smart Contract

- **Tanpa OpenZeppelin**: `ECDSA` (tolak signature malleable), `EIP712`, `AccessControl`, `ReentrancyGuard`, `Pausable`, ERC-721, ERC-2771 ditulis sendiri. Ini risiko terbesar: wajib audit atau ganti ke library teraudit sebelum dana nyata.
- Signature mendukung EOA dan smart account (ERC-1271).
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
