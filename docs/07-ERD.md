# 07 — Entity Relationship Diagram

```mermaid
erDiagram
    USERS ||--o{ DEBT_NOTES : "kreditur"
    USERS ||--o{ DEBT_NOTES : "debitur"
    USERS ||--o{ DEBT_NOTES : "pembuat"
    USERS ||--o{ SIGNATURES : "penanda tangan"
    USERS ||--o{ DISPUTES : "pengaju"
    USERS ||--o{ AUTH_NONCES : has
    DEBT_NOTES ||--o{ NOTE_VERSIONS : has
    NOTE_VERSIONS ||--o{ SIGNATURES : has
    NOTE_VERSIONS ||--o{ DOCUMENTS : has
    NOTE_VERSIONS ||--o{ INSTALLMENTS : has
    DEBT_NOTES ||--o{ PAYMENTS : has
    INSTALLMENTS ||--o{ PAYMENT_ALLOCATIONS : has
    PAYMENTS ||--o{ PAYMENT_ALLOCATIONS : has
    DEBT_NOTES ||--o{ DISPUTES : has
    DEBT_NOTES ||--o{ INTEGRITY_CHECKS : has
    DEBT_NOTES ||--o{ CHAIN_TXS : has
    USERS ||--o{ NOTIFICATIONS : receives
    USERS ||--o{ AUDIT_LOGS : actor

    USERS {
        uuid id PK
        string wallet_address UK
        string wallet_type "external|embedded"
        string full_name
        string email
        string phone
        timestamp phone_verified_at
        bool is_admin
    }
    DEBT_NOTES {
        uuid id PK
        bytes32 chain_note_id UK
        uuid creator_id FK
        uuid creditor_id FK "null sampai pihak lawan bergabung"
        uuid debtor_id FK "null sampai pihak lawan bergabung"
        int current_version
        string status "DRAFT|PENDING_SIGNATURE|AWAITING_DISBURSEMENT|ACTIVE|OVERDUE|DISPUTED|FROZEN|PAID|REJECTED|CANCELLED"
        string status_before_freeze
        bytes32 minted_doc_hash UK "diisi saat mint"
        string integrity_status "VERIFIED|TAMPERED|UNCHECKED"
        numeric outstanding_amount "cache dari contract"
        numeric late_fee_accrued "cache dari contract"
        timestamp disbursement_confirmed_at
        bigint token_id
        string mint_tx_hash
        string invite_token
    }
    NOTE_VERSIONS {
        uuid id PK
        uuid note_id FK
        int version
        string title
        string debt_type
        numeric principal
        string interest_type "none|percent|flat"
        numeric interest_value
        string repayment_scheme "single|installment"
        date due_date
        int late_fee_bps "0 atau 200"
        numeric interest_amount
        text collateral_note
        string disbursement "onchain|offchain"
        bytes32 doc_hash
        bytes32 schedule_hash
        bytes32 terms_hash
        bool is_current
    }
    SIGNATURES {
        uuid id PK
        uuid version_id FK
        uuid signer_id FK
        string role "creditor|debtor"
        text signature
        numeric nonce
        timestamp deadline
        bool is_valid
    }
    DOCUMENTS {
        uuid id PK
        uuid version_id FK
        string storage_key
        string mime_type
        int size_bytes
        bytes32 file_hash
    }
    INSTALLMENTS {
        uuid id PK
        uuid version_id FK
        int seq
        date due_date
        numeric amount
        numeric paid_amount
        string status "UNPAID|PARTIAL|PAID|OVERDUE"
    }
    PAYMENTS {
        uuid id PK
        uuid note_id FK
        string method "onchain|offchain"
        numeric amount
        numeric to_installments
        numeric to_late_fee
        string status "PENDING|CONFIRMED|REJECTED"
        string proof_storage_key
        text creditor_signature
        string reject_reason
        string tx_hash
        int log_index
    }
    PAYMENT_ALLOCATIONS {
        uuid payment_id FK
        uuid installment_id FK
        numeric amount
    }
    DISPUTES {
        uuid id PK
        uuid note_id FK
        uuid opened_by FK
        text reason
        string status "OPEN|CLOSED"
        text resolution
        uuid closed_by FK
    }
    INTEGRITY_CHECKS {
        uuid id PK
        uuid note_id FK
        bytes32 db_hash
        bytes32 chain_hash
        string result "VERIFIED|TAMPERED"
        timestamp checked_at
    }
    CHAIN_TXS {
        uuid id PK
        uuid note_id FK
        string kind "deposit|refund|activate|pay|confirm|amend|mark_paid|dispute_open|dispute_close|freeze|unfreeze|faucet"
        string status "QUEUED|SENT|MINED|FAILED"
        string tx_hash
        int attempts
        string idempotency_key UK
    }
    AUTH_NONCES {
        string nonce PK
        uuid user_id FK
        timestamp expires_at
    }
    NOTIFICATIONS {
        uuid id PK
        uuid user_id FK
        string type
        jsonb payload
        timestamp read_at
    }
    AUDIT_LOGS {
        uuid id PK
        uuid actor_id FK
        string entity
        uuid entity_id
        string action
        jsonb before
        jsonb after
        timestamp created_at
    }
```

## Catatan

- `NOTE_VERSIONS` immutable: revisi = baris baru, `is_current` dipindah. `doc_hash` **tidak** unik di tabel ini karena revisi yang hanya mengubah jadwal memakai dokumen yang sama.
- Anti double-mint di DB: `DEBT_NOTES.minted_doc_hash` unik, diisi dari versi yang di-mint (cermin `usedDocHash` di contract).
- Burn terjadi di dalam tx pembayaran/konfirmasi/`markPaid` (atau saat dispute ditutup / unfreeze), jadi tidak ada `kind` burn terpisah di `CHAIN_TXS`.
- `DEBT_NOTES.token_id` = `uint256(chain_note_id)`.
- `PAYMENTS (tx_hash, log_index)` unik untuk idempotency event on-chain.
- `DEBT_NOTES.status` ACTIVE/PAID/DISPUTED/FROZEN diperbarui indexer dari `StatusChanged`; OVERDUE disinkronkan cron dengan membaca `statusOf()` (contract tidak memancarkan event untuk OVERDUE). `INSTALLMENTS.paid_amount` diturunkan dari `scheduledPaid` di `getNote()` (alokasi tertua dulu) setelah event `PaymentRecorded`.
- `AUDIT_LOGS` append-only (tanpa UPDATE/DELETE lewat RLS atau trigger).
