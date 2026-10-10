// Deploy Collatera: MockIDRX, CollateraForwarder, DebtNote, DebtManager (+ wiring & role).
//   npx hardhat run scripts/deploy.js --network sepolia
// Env opsional: ADMIN_ADDRESS (default deployer; di produksi pakai multisig), FREEZER_ADDRESS (integrity checker),
//               FAUCET_AMOUNT_IDR (default 10.000.000), STABLECOIN_DECIMALS (default 2)
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const LOCAL_NETWORKS = ["hardhat", "localhost"];
const NL = String.fromCharCode(10);

/** Peringatan deploy (fungsi murni, diuji di test/70). Dicetak keras oleh main(). */
function deployWarnings({ networkName, admin, deployer, freezer }) {
  const w = [];
  if (!LOCAL_NETWORKS.includes(networkName) && admin.toLowerCase() === deployer.toLowerCase()) {
    w.push(
      [
        `!!! PERINGATAN: ADMIN == DEPLOYER di network '${networkName}'.`,
        "!!! Satu key memegang DEFAULT_ADMIN_ROLE + ADMIN_ROLE (freeze, pause, closeDispute). Key bocor = semua piutang bisa dibekukan.",
        "!!! Set ADMIN_ADDRESS ke multisig sebelum dipakai dengan dana nyata. closeExpiredDispute hanya mitigasi sengketa menggantung.",
      ].join(NL)
    );
  }
  if (freezer && admin.toLowerCase() !== deployer.toLowerCase()) {
    w.push(
      [
        "!!! FREEZER_ROLE BELUM diberikan (ADMIN_ADDRESS bukan deployer). Admin harus menjalankan manual:",
        `!!!   DebtManager.grantRole(keccak256("FREEZER_ROLE"), ${freezer})`,
      ].join(NL)
    );
  }
  return w;
}

async function main({ quiet = false, writeFile = true } = {}) {
  const log = (...a) => (quiet ? undefined : console.log(...a));
  const [deployer] = await ethers.getSigners();
  const admin = process.env.ADMIN_ADDRESS || deployer.address;
  const decimals = Number(process.env.STABLECOIN_DECIMALS || 2);
  const faucetAmount = BigInt(process.env.FAUCET_AMOUNT_IDR || 10_000_000) * 10n ** BigInt(decimals);

  log(`Network   : ${network.name}`);
  log(`Deployer  : ${deployer.address}`);
  log(`Admin     : ${admin}`);
  const warnings = deployWarnings({ networkName: network.name, admin, deployer: deployer.address, freezer: process.env.FREEZER_ADDRESS });
  if (!quiet) for (const w of warnings) console.warn(NL + w + NL);

  // Berurutan: tunggu tiap deploy ter-mine dulu. RPC publik yang di-load-balance bisa mengembalikan nonce
  // basi kalau tx berikutnya dikirim sebelum yang sebelumnya masuk blok ("replacement transaction underpriced").
  const idrx = await ethers.deployContract("MockIDRX", [decimals, deployer.address, faucetAmount]);
  await idrx.waitForDeployment();
  const forwarder = await ethers.deployContract("CollateraForwarder");
  await forwarder.waitForDeployment();
  const debtNote = await ethers.deployContract("DebtNote");
  await debtNote.waitForDeployment();

  const manager = await ethers.deployContract("DebtManager", [debtNote.target, idrx.target, forwarder.target, admin]);
  await manager.waitForDeployment();

  await (await debtNote.setManager(manager.target)).wait();
  // Forwarder hanya boleh meneruskan ke DebtManager (diset sekali).
  await (await forwarder.setManager(manager.target)).wait();

  if (process.env.FREEZER_ADDRESS) {
    // Peringatan "belum diberikan" sudah dicetak di atas bila admin bukan deployer.
    if (admin.toLowerCase() === deployer.address.toLowerCase()) {
      const FREEZER_ROLE = ethers.id("FREEZER_ROLE");
      await (await manager.grantRole(FREEZER_ROLE, process.env.FREEZER_ADDRESS)).wait();
      if (!(await manager.hasRole(FREEZER_ROLE, process.env.FREEZER_ADDRESS))) {
        throw new Error("grant FREEZER_ROLE gagal diverifikasi");
      }
      log(`FREEZER_ROLE diberikan dan terverifikasi → ${process.env.FREEZER_ADDRESS}`);
    }
  }

  const { chainId } = await ethers.provider.getNetwork();
  const out = {
    network: network.name,
    chainId: Number(chainId),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    admin,
    stablecoinDecimals: decimals,
    contracts: {
      MockIDRX: idrx.target,
      CollateraForwarder: forwarder.target,
      DebtNote: debtNote.target,
      DebtManager: manager.target,
    },
    constructorArgs: {
      MockIDRX: [decimals, deployer.address, faucetAmount.toString()],
      CollateraForwarder: [],
      DebtNote: [],
      DebtManager: [debtNote.target, idrx.target, forwarder.target, admin],
    },
  };
  if (writeFile) {
    const dir = path.join(__dirname, "..", "deployments");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${network.name}.json`), JSON.stringify(out, null, 2));
  }

  log(out.contracts);
  if (writeFile) log(`Disimpan di deployments/${network.name}.json`);
  return { manager: manager.target, forwarder: forwarder.target, warnings };
}

module.exports = { main, deployWarnings };

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
