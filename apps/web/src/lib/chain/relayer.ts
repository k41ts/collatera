// Relayer (server saja): membayar gas untuk semua transaksi pengguna.
// Semua pengiriman tx diserialkan lewat satu antrean in-process supaya nonce wallet relayer tidak bentrok.
import fs from "node:fs";
import path from "node:path";
import { Contract, JsonRpcProvider, NonceManager, Wallet, type TransactionReceipt, type TransactionRequest, type TransactionResponse } from "ethers";
import { ABI, ADDR, CHAIN_ID } from "./config";

function relayerKey(): string {
  const k = process.env.RELAYER_PRIVATE_KEY?.trim();
  if (k) return k;
  // Dev: pakai deployer dari piutangchain-contracts/.env (owner MockIDRX + ADMIN_ROLE) tanpa menyalin key.
  if (process.env.NODE_ENV !== "production") {
    const p = path.resolve(process.cwd(), "../../piutangchain-contracts/.env");
    if (fs.existsSync(p)) {
      const m = fs.readFileSync(p, "utf8").match(/^DEPLOYER_PRIVATE_KEY=\s*([^\s#]+)/m);
      if (m) return m[1];
    }
  }
  throw new Error("RELAYER_PRIVATE_KEY belum diisi di apps/web/.env");
}

type Chain = {
  provider: JsonRpcProvider;
  signer: NonceManager;
  address: string;
  manager: Contract;
  idrx: Contract;
  forwarder: Contract;
  debtNote: Contract;
  queue: Promise<unknown>;
};

const g = globalThis as unknown as { __chain?: Chain };

export function chain(): Chain {
  if (g.__chain) return g.__chain;
  const provider = new JsonRpcProvider(process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com", CHAIN_ID, {
    staticNetwork: true,
  });
  const wallet = new Wallet(relayerKey(), provider);
  const signer = new NonceManager(wallet);
  g.__chain = {
    provider,
    signer,
    address: wallet.address,
    manager: new Contract(ADDR.DebtManager, ABI.DebtManager, signer),
    idrx: new Contract(ADDR.MockIDRX, ABI.MockIDRX, signer),
    forwarder: new Contract(ADDR.PiutangForwarder, ABI.PiutangForwarder, signer),
    debtNote: new Contract(ADDR.DebtNote, ABI.DebtNote, provider),
    queue: Promise.resolve(),
  };
  return g.__chain;
}

/** Baca-saja (tanpa butuh key relayer). */
export function reader() {
  const provider =
    g.__chain?.provider ??
    new JsonRpcProvider(process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com", CHAIN_ID, { staticNetwork: true });
  return {
    provider,
    manager: new Contract(ADDR.DebtManager, ABI.DebtManager, provider),
    idrx: new Contract(ADDR.MockIDRX, ABI.MockIDRX, provider),
    forwarder: new Contract(ADDR.PiutangForwarder, ABI.PiutangForwarder, provider),
  };
}

export class ChainError extends Error {
  constructor(message: string, readonly reason?: string) {
    super(message);
  }
}

/** Kirim tx lewat antrean relayer, tunggu 1 konfirmasi. Gas diestimasi ulang + 30% (estimasi RPC publik yang
 *  di-load-balance bisa terlalu rendah dan membuat tx kehabisan gas). Revert diterjemahkan ke nama error kontrak. */
export async function relay(label: string, build: (c: Chain) => Promise<TransactionRequest>): Promise<TransactionReceipt> {
  const c = chain();
  const run = async () => {
    let hash: string | undefined;
    try {
      const req = await build(c);
      if (req.gasLimit == null) {
        // Node RPC bisa tertinggal satu blok dari tx sebelumnya (mis. aktivasi tepat setelah setor escrow): ulangi estimasi.
        for (let i = 0; ; i++) {
          try {
            req.gasLimit = ((await c.signer.estimateGas(req)) * BigInt(13)) / BigInt(10) + BigInt(50_000);
            break;
          } catch (e) {
            if (i >= 2) throw e;
            await new Promise((r) => setTimeout(r, 3000));
          }
        }
      }
      const tx: TransactionResponse = await c.signer.sendTransaction(req);
      hash = tx.hash;
      const rc = await tx.wait(1);
      if (!rc || rc.status !== 1) throw new ChainError(`${label} gagal di blockchain`);
      return rc;
    } catch (e) {
      c.signer.reset(); // nonce bisa tidak sinkron setelah gagal
      const reason = decodeRevert(e);
      console.error(`[relayer] ${label} gagal${hash ? ` (tx ${hash})` : ""}: ${reason}`);
      throw new ChainError(`${label} gagal: ${reason}${hash ? ` (tx ${hash})` : ""}`, reason);
    }
  };
  const p = c.queue.then(run, run);
  c.queue = p.catch(() => undefined);
  return p;
}

function decodeRevert(e: unknown): string {
  const err = e as { revert?: { name?: string }; data?: string; info?: { error?: { data?: string } }; shortMessage?: string; message?: string };
  if (err?.revert?.name) return err.revert.name;
  const data = err?.data ?? err?.info?.error?.data;
  if (typeof data === "string" && data.length >= 10) {
    for (const abi of [ABI.DebtManager, ABI.PiutangForwarder, ABI.MockIDRX]) {
      try {
        const parsed = new Contract(ADDR.DebtManager, abi).interface.parseError(data);
        if (parsed) return parsed.name;
      } catch {
        /* coba ABI berikutnya */
      }
    }
  }
  return err?.shortMessage ?? err?.message ?? "error tidak dikenal";
}
