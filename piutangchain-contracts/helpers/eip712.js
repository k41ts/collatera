// Helper EIP-712 untuk PiutangChain. Dipakai test dan bisa dipakai ulang di backend/frontend
// (ethers v6) supaya payload yang ditandatangani PERSIS sama dengan yang diverifikasi kontrak.
const { TypedDataEncoder } = require("ethers");

const DEBT_MANAGER_DOMAIN_NAME = "PiutangChain";
const DOMAIN_VERSION = "1";

const NOTE_TYPES = {
  Note: [
    { name: "noteId", type: "bytes32" },
    { name: "version", type: "uint32" },
    { name: "creditor", type: "address" },
    { name: "debtor", type: "address" },
    { name: "docHash", type: "bytes32" },
    { name: "scheduleHash", type: "bytes32" },
    { name: "principal", type: "uint256" },
    { name: "totalOwed", type: "uint256" },
    { name: "lateFee", type: "uint256" },
    { name: "dueDate", type: "uint64" },
    { name: "disbursement", type: "uint8" },
    { name: "deadline", type: "uint64" },
    { name: "creditorNonce", type: "uint256" },
    { name: "debtorNonce", type: "uint256" },
  ],
};

const RECEIPT_TYPES = {
  DisbursementReceipt: [
    { name: "noteHash", type: "bytes32" },
    { name: "proofHash", type: "bytes32" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
};

const PAYMENT_TYPES = {
  PaymentConfirmation: [
    { name: "noteId", type: "bytes32" },
    { name: "amount", type: "uint256" },
    { name: "proofHash", type: "bytes32" },
    { name: "installmentIndex", type: "uint32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
};

const AMENDMENT_TYPES = {
  Amendment: [
    { name: "noteId", type: "bytes32" },
    { name: "newVersion", type: "uint32" },
    { name: "newDocHash", type: "bytes32" },
    { name: "newScheduleHash", type: "bytes32" },
    { name: "newTotalOwed", type: "uint256" },
    { name: "newLateFee", type: "uint256" },
    { name: "newDueDate", type: "uint64" },
    { name: "deadline", type: "uint64" },
    { name: "creditorNonce", type: "uint256" },
    { name: "debtorNonce", type: "uint256" },
  ],
};

const FORWARD_TYPES = {
  ForwardRequest: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint48" },
    { name: "data", type: "bytes" },
  ],
};

const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

const managerDomain = (chainId, verifyingContract) => ({
  name: DEBT_MANAGER_DOMAIN_NAME,
  version: DOMAIN_VERSION,
  chainId,
  verifyingContract,
});
const forwarderDomain = (chainId, verifyingContract) => ({
  name: "PiutangForwarder",
  version: DOMAIN_VERSION,
  chainId,
  verifyingContract,
});
const tokenDomain = (chainId, verifyingContract) => ({
  name: "Mock IDRX",
  version: DOMAIN_VERSION,
  chainId,
  verifyingContract,
});

/** Struct hash Note (kunci escrow & referensi receipt). Sama dengan DebtManager.noteHash(note). */
const noteStructHash = (note) => TypedDataEncoder.hashStruct("Note", NOTE_TYPES, note);

/** Pecah signature permit hex menjadi {v, r, s} untuk struct Permit di kontrak. */
function splitSig(sig) {
  return { v: Number("0x" + sig.slice(130, 132)), r: "0x" + sig.slice(2, 66), s: "0x" + sig.slice(66, 130) };
}

module.exports = {
  NOTE_TYPES,
  RECEIPT_TYPES,
  PAYMENT_TYPES,
  AMENDMENT_TYPES,
  FORWARD_TYPES,
  PERMIT_TYPES,
  managerDomain,
  forwarderDomain,
  tokenDomain,
  noteStructHash,
  splitSig,
};
