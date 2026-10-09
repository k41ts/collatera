// Tipe EIP-712. HARUS identik dengan piutangchain-contracts/helpers/eip712.js (urutan & tipe field menentukan hash).
import { ADDR, CHAIN_ID } from "./config";

export const NOTE_TYPES = {
  Note: [
    { name: "noteId", type: "bytes32" },
    { name: "version", type: "uint32" },
    { name: "creditor", type: "address" },
    { name: "debtor", type: "address" },
    { name: "docHash", type: "bytes32" },
    { name: "scheduleHash", type: "bytes32" },
    { name: "principal", type: "uint256" },
    { name: "totalOwed", type: "uint256" },
    { name: "lateFeeBps", type: "uint16" },
    { name: "dueDate", type: "uint64" },
    { name: "disbursement", type: "uint8" },
    { name: "deadline", type: "uint64" },
    { name: "creditorNonce", type: "uint256" },
    { name: "debtorNonce", type: "uint256" },
  ],
};

export const RECEIPT_TYPES = {
  DisbursementReceipt: [
    { name: "noteHash", type: "bytes32" },
    { name: "proofHash", type: "bytes32" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
};

export const PAYMENT_TYPES = {
  PaymentConfirmation: [
    { name: "noteId", type: "bytes32" },
    { name: "amount", type: "uint256" },
    { name: "proofHash", type: "bytes32" },
    { name: "installmentIndex", type: "uint32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
};

export const FORWARD_TYPES = {
  ForwardRequest: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint48" },
    { name: "data", type: "bytes" },
  ],
};

export const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

export const managerDomain = { name: "PiutangChain", version: "1", chainId: CHAIN_ID, verifyingContract: ADDR.DebtManager };
export const forwarderDomain = { name: "PiutangForwarder", version: "1", chainId: CHAIN_ID, verifyingContract: ADDR.PiutangForwarder };
export const tokenDomain = { name: "Mock IDRX", version: "1", chainId: CHAIN_ID, verifyingContract: ADDR.MockIDRX };

/** Struct Note dalam bentuk JSON (angka besar sebagai string). */
export type NoteTerms = {
  noteId: string;
  version: number;
  creditor: string;
  debtor: string;
  docHash: string;
  scheduleHash: string;
  principal: string;
  totalOwed: string;
  lateFeeBps: number;
  dueDate: number;
  disbursement: number;
  deadline: number;
  creditorNonce: string;
  debtorNonce: string;
};

export type Schedule = { dueDates: number[]; amounts: string[] };

export type ForwardRequest = {
  from: string;
  to: string;
  gas: string;
  nonce: string;
  deadline: number;
  data: string;
};

export type PermitSig = { deadline: string; v: number; r: string; s: string };

export function splitSig(sig: string): { v: number; r: string; s: string } {
  return { v: Number("0x" + sig.slice(130, 132)), r: "0x" + sig.slice(2, 66), s: "0x" + sig.slice(66, 130) };
}
