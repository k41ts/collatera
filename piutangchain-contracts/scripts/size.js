// Cetak ukuran bytecode deployed (batas EIP-170: 24576 byte). Jalankan setelah `npm run compile`.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..", "artifacts", "contracts");
for (const name of ["DebtManager", "DebtNote", "MockIDRX", "PiutangForwarder"]) {
  const file = path.join(root, `${name}.sol`, `${name}.json`);
  const bytes = (JSON.parse(fs.readFileSync(file, "utf8")).deployedBytecode.length - 2) / 2;
  console.log(`${name.padEnd(18)} ${String(bytes).padStart(6)} B  (${((bytes / 24576) * 100).toFixed(1)}% dari batas)`);
}
