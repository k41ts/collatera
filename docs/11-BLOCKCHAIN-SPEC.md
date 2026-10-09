# 11 — Blockchain Specification

Chain: **Ethereum Sepolia** (`chainId 11155111`) · Solidity `^0.8.24` · OpenZeppelin v5.

## Contracts

| Contract | Standar | Fungsi |
|----------|---------|--------|
| `PiutangNote` | ERC-721, EIP-712, ERC-2771 | Token piutang, escrow, repayment, freeze |
| `MockIDR` | ERC-20 + EIP-2612 permit | Stablecoin IDR tiruan, 18 desimal, faucet |
| `Forwarder` | ERC2771Forwarder | Meta-tx gasless lewat relayer |

## Data On-chain per Token

```solidity
enum Status { ACTIVE, OVERDUE, DISPUTED, FROZEN, PAID }

struct Note {
    bytes32 noteId;
    bytes32 termsHash;     // EIP-712 struct hash DebtNote
    bytes32 docHash;
    address creditor;
    address debtor;
    uint256 principal;
    uint256 outstanding;
    uint64  dueDate;
    Status  status;
    Status  statusBeforeDispute;
}

mapping(uint256 => Note) public notes;           // tokenId → Note
mapping(bytes32 => bool) public usedDocHash;
mapping(address => uint256) public nonces;
```

Tidak ada nama, email, HP, atau isi dokumen di contract.

## Fungsi

| Fungsi | Pemanggil | Aturan |
|--------|-----------|--------|
| `mintNote(DebtNote terms, bytes sigCreditor, bytes sigDebtor, Permit escrowPermit)` | `RELAYER_ROLE` | Verifikasi 2 signature, deadline, nonce; `docHash` belum dipakai; jika on-chain: tarik escrow via permit lalu transfer ke debitur; mint ke kreditur |
| `repay(uint256 tokenId, uint256 amount, Permit permit)` | relayer (atas nama debitur) | Status ≠ FROZEN/PAID; `amount ≤ outstanding`; transfer IDR debitur → kreditur; kurangi `outstanding`; jika 0 → burn |
| `confirmOffchainPayment(uint256 tokenId, uint256 amount, bytes sigCreditor)` | `RELAYER_ROLE` | Signature kreditur valid; status ACTIVE/OVERDUE; kurangi `outstanding`; jika 0 → burn |
| `markOverdue(uint256 tokenId)` | siapa saja | `block.timestamp > dueDate` dan `outstanding > 0` |
| `setDisputed(uint256 tokenId, bool open)` | `GUARDIAN_ROLE` | Simpan/pulihkan `statusBeforeDispute` |
| `freeze(uint256 tokenId)` / `unfreeze` | `GUARDIAN_ROLE` | Freeze dari status apa pun |
| `verify(uint256 tokenId, bytes32 termsHash, bytes32 docHash) view` | siapa saja | Return `true` jika cocok |
| `pause()` / `unpause()` | `DEFAULT_ADMIN_ROLE` | Darurat |

Saat DISPUTED: `repay` tetap jalan, tapi burn ditunda sampai dispute ditutup; `confirmOffchainPayment` ditolak.

## Events

```solidity
event NoteMinted(uint256 indexed tokenId, bytes32 indexed noteId, address creditor, address debtor, bytes32 termsHash, bytes32 docHash);
event Repaid(uint256 indexed tokenId, uint256 amount, uint256 outstanding, bool onchain);
event StatusChanged(uint256 indexed tokenId, Status from, Status to);
event NoteBurned(uint256 indexed tokenId);
```

## Non-transferable

```solidity
function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
    address from = _ownerOf(tokenId);
    if (from != address(0) && to != address(0)) revert NonTransferable();
    return super._update(to, tokenId, auth);
}
```

## Gasless

- Tanda tangan perjanjian & konfirmasi: **EIP-712 off-chain**, dikirim relayer.
- Pergerakan stablecoin: **EIP-2612 permit**, sehingga debitur/kreditur tidak perlu `approve` (tx bergas).
- Relayer membayar gas Sepolia ETH; antrean + retry di BullMQ.

## Custom Errors

`InvalidSignature`, `SignatureExpired`, `DocHashUsed`, `NoteFrozen`, `InvalidStatus`, `AmountExceedsOutstanding`, `NonTransferable`.
