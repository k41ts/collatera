// Alamat + ABI kontrak di jaringan target. Sumber: scripts/sync-contracts.mjs.
import deployment from "./deployment.json";

export const CHAIN_ID = deployment.chainId;
export const DECIMALS = deployment.stablecoinDecimals;
export const ADDR = deployment.addresses as {
  MockIDRX: string;
  CollateraForwarder: string;
  DebtNote: string;
  DebtManager: string;
};
export const ABI = deployment.abi;
export const EXPLORER = CHAIN_ID === 11155111 ? "https://sepolia.etherscan.io" : "";
export const PUBLIC_RPC = "https://ethereum-sepolia-rpc.publicnode.com";

/** Urutan enum Status di DebtManager. */
export const CHAIN_STATUS = ["NONE", "ACTIVE", "OVERDUE", "PAID", "DISPUTED", "FROZEN"] as const;

export const txUrl = (hash?: string | null) => (hash && EXPLORER ? `${EXPLORER}/tx/${hash}` : null);
export const addressUrl = (a: string) => (EXPLORER ? `${EXPLORER}/address/${a}` : null);
