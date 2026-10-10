// Salin ABI + alamat kontrak dari collatera-contracts ke web app.
//   npm run sync-contracts            (default: deployments/sepolia.json)
//   NETWORK=localhost npm run sync-contracts
// Jalankan ulang setiap kali kontrak di-compile ulang atau di-deploy ulang.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const contractsDir = path.resolve(here, "../../../collatera-contracts");
const network = process.env.NETWORK || "sepolia";

const deployment = JSON.parse(fs.readFileSync(path.join(contractsDir, "deployments", `${network}.json`), "utf8"));
const abiOf = (name) =>
  JSON.parse(fs.readFileSync(path.join(contractsDir, "artifacts/contracts", `${name}.sol`, `${name}.json`), "utf8")).abi;

const out = {
  network: deployment.network,
  chainId: deployment.chainId,
  stablecoinDecimals: deployment.stablecoinDecimals,
  deployedAt: deployment.deployedAt,
  addresses: deployment.contracts,
  abi: {
    DebtManager: abiOf("DebtManager"),
    DebtNote: abiOf("DebtNote"),
    MockIDRX: abiOf("MockIDRX"),
    CollateraForwarder: abiOf("CollateraForwarder"),
  },
};

const target = path.resolve(here, "../src/lib/chain/deployment.json");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(out, null, 2) + "\n");
console.log(`Tersalin: ${network} (chainId ${out.chainId}) → src/lib/chain/deployment.json`);
console.log(out.addresses);
