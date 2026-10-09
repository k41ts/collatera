"use client";
// Helper sisi browser: panggilan API, MetaMask, tanda tangan EIP-712, dan aksi gasless lewat forwarder.
import { BrowserProvider, Contract, Interface, type Eip1193Provider, type TypedDataField } from "ethers";
import { ABI, ADDR, CHAIN_ID } from "./chain/config";
import { FORWARD_TYPES, PERMIT_TYPES, forwarderDomain, splitSig, tokenDomain } from "./chain/eip712";

declare global {
  interface Window {
    ethereum?: Eip1193Provider & { on?: (e: string, cb: (...a: unknown[]) => void) => void };
  }
}

export async function api<T = unknown>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.json !== undefined ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? `Permintaan gagal (${res.status})`);
  return data as T;
}

export const hasWallet = () => typeof window !== "undefined" && !!window.ethereum;

const SEPOLIA_HEX = "0x" + CHAIN_ID.toString(16);

export async function ensureNetwork() {
  const eth = window.ethereum;
  if (!eth) throw new Error("MetaMask tidak ditemukan. Pasang ekstensi MetaMask dulu.");
  const current = (await eth.request({ method: "eth_chainId" })) as string;
  if (current?.toLowerCase() === SEPOLIA_HEX) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA_HEX }] });
  } catch (e) {
    if ((e as { code?: number }).code === 4902) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: SEPOLIA_HEX,
          chainName: "Sepolia",
          nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
          blockExplorerUrls: ["https://sepolia.etherscan.io"],
        }],
      });
    } else throw new Error("Pindahkan jaringan wallet ke Sepolia untuk melanjutkan.");
  }
}

export async function getSigner(expected?: string) {
  await ensureNetwork();
  const provider = new BrowserProvider(window.ethereum!);
  const signer = await provider.getSigner();
  if (expected && (await signer.getAddress()).toLowerCase() !== expected.toLowerCase())
    throw new Error(`Akun MetaMask yang aktif berbeda dengan akun login (${expected.slice(0, 6)}…${expected.slice(-4)}). Ganti akun di MetaMask.`);
  return { provider, signer };
}

/** Sign-In with Ethereum (EIP-4361). */
export async function loginWithWallet() {
  const eth = window.ethereum;
  if (!eth) throw new Error("MetaMask tidak ditemukan. Pasang ekstensi MetaMask dulu.");
  await eth.request({ method: "eth_requestAccounts" });
  const { signer } = await getSigner();
  const address = await signer.getAddress();
  const { nonce } = await api<{ nonce: string }>("/api/auth/nonce", { method: "POST" });
  const message = [
    `${window.location.host} wants you to sign in with your Ethereum account:`,
    address,
    "",
    "Masuk ke PiutangChain. Tanda tangan ini gratis dan tidak membuat transaksi.",
    "",
    `URI: ${window.location.origin}`,
    "Version: 1",
    `Chain ID: ${CHAIN_ID}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join("\n");
  const signature = await signer.signMessage(message);
  return api<{ user: { id: string; wallet: string } }>("/api/auth/verify", { method: "POST", json: { message, signature } });
}

type Typed = { domain: Record<string, unknown>; types: Record<string, TypedDataField[]>; message: Record<string, unknown> };

export async function signTyped(t: Typed, expected?: string) {
  const { signer } = await getSigner(expected);
  return signer.signTypedData(t.domain, t.types, t.message);
}

const manager = new Interface(ABI.DebtManager);

/** Tanda tangani ForwardRequest untuk memanggil DebtManager.<fn>(args) tanpa gas, lalu kirim ke server. */
export async function forwardAction(opts: {
  noteId: string;
  wallet: string;
  fn: string;
  args: unknown[];
  purpose: string;
  reason?: string;
}) {
  const { provider, signer } = await getSigner(opts.wallet);
  const forwarder = new Contract(ADDR.PiutangForwarder, ABI.PiutangForwarder, provider);
  const nonce = (await forwarder.nonces(opts.wallet)).toString();
  const request = {
    from: opts.wallet,
    to: ADDR.DebtManager,
    gas: "900000",
    nonce,
    deadline: Math.floor(Date.now() / 1000) + 3600,
    data: manager.encodeFunctionData(opts.fn, opts.args),
  };
  const signature = await signer.signTypedData(forwarderDomain, FORWARD_TYPES, request);
  return api<{ txHash: string }>(`/api/notes/${opts.noteId}/forward`, {
    method: "POST",
    json: { purpose: opts.purpose, reason: opts.reason, request, signature },
  });
}

/** Bayar on-chain: tanda tangani permit IDRX lalu ForwardRequest payOnchain (dua tanda tangan, tanpa gas). */
export async function payOnchain(opts: { noteId: string; chainNoteId: string; wallet: string; amount: string; installment: number }) {
  const { provider, signer } = await getSigner(opts.wallet);
  const idrx = new Contract(ADDR.MockIDRX, ABI.MockIDRX, provider);
  const [nonce, balance] = await Promise.all([idrx.nonces(opts.wallet), idrx.balanceOf(opts.wallet)]);
  if (balance < BigInt(opts.amount)) throw new Error("Saldo IDRX kamu kurang. Ambil dari faucet di halaman Profil.");
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const permitSig = await signer.signTypedData(tokenDomain, PERMIT_TYPES, {
    owner: opts.wallet, spender: ADDR.DebtManager, value: opts.amount, nonce, deadline,
  });
  const permit = { deadline, ...splitSig(permitSig) };
  return forwardAction({
    noteId: opts.noteId,
    wallet: opts.wallet,
    fn: "payOnchain",
    args: [opts.chainNoteId, opts.amount, opts.installment, permit],
    purpose: "pay",
  });
}

export const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
