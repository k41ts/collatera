// Rumus hash yang disepakati backend (docs/05-TECH-SPEC.md § Hashing).
import { AbiCoder, keccak256, solidityPacked, toUtf8Bytes } from "ethers";

/** noteId on-chain = keccak256(uuid). */
export const chainNoteId = (uuid: string) => keccak256(toUtf8Bytes(uuid));

/** Canonical JSON: key diurutkan, tanpa spasi, semua nilai string. */
export function canonicalJson(obj: Record<string, string | number>): string {
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + JSON.stringify(String(obj[k]))).join(",") + "}";
}

export type PayloadFields = {
  title: string;
  debtType: string;
  interestType: string;
  interestValue: string;
  collateralNote: string;
  disbursement: string;
  version: number;
};

export const payloadHash = (p: PayloadFields) => keccak256(toUtf8Bytes(canonicalJson(p)));

/** docHash = keccak256(abi.encodePacked(payloadHash, sorted(fileHashes))). */
export function docHash(p: PayloadFields, fileHashes: string[]): string {
  const sorted = [...fileHashes].map((h) => h.toLowerCase()).sort();
  const types = ["bytes32", ...sorted.map(() => "bytes32")];
  return keccak256(solidityPacked(types, [payloadHash(p), ...sorted]));
}

/** scheduleHash = keccak256(abi.encode(uint64[] dueDates, uint256[] amounts)). */
export const scheduleHash = (dueDates: number[], amounts: string[]) =>
  keccak256(AbiCoder.defaultAbiCoder().encode(["uint64[]", "uint256[]"], [dueDates, amounts]));

export const fileHash = (buf: Uint8Array) => keccak256(buf);
