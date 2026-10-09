// Deploy PiutangChain: MockIDRX, PiutangForwarder, DebtNote, DebtManager (+ wiring & role).
//   npx hardhat run scripts/deploy.js --network sepolia
// Env opsional: ADMIN_ADDRESS (default deployer; di produksi pakai multisig), FREEZER_ADDRESS (integrity checker),
//               FAUCET_AMOUNT_IDR (default 10.000.000), STABLECOIN_DECIMALS (default 2)
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const admin = process.env.ADMIN_ADDRESS || deployer.address;
  const decimals = Number(process.env.STABLECOIN_DECIMALS || 2);
  const faucetAmount = BigInt(process.env.FAUCET_AMOUNT_IDR || 10_000_000) * 10n ** BigInt(decimals);

  console.log(`Network   : ${network.name}`);
  console.log(`Deployer  : ${deployer.address}`);
  console.log(`Admin     : ${admin}`);

  // Berurutan: tunggu tiap deploy ter-mine dulu. RPC publik yang di-load-balance bisa mengembalikan nonce
  // basi kalau tx berikutnya dikirim sebelum yang sebelumnya masuk blok ("replacement transaction underpriced").
  const idrx = await ethers.deployContract("MockIDRX", [decimals, deployer.address, faucetAmount]);
  await idrx.waitForDeployment();
  const forwarder = await ethers.deployContract("PiutangForwarder");
  await forwarder.waitForDeployment();
  const debtNote = await ethers.deployContract("DebtNote");
  await debtNote.waitForDeployment();

  const manager = await ethers.deployContract("DebtManager", [debtNote.target, idrx.target, forwarder.target, admin]);
  await manager.waitForDeployment();

  await (await debtNote.setManager(manager.target)).wait();
  // Forwarder hanya boleh meneruskan ke DebtManager (diset sekali).
  await (await forwarder.setManager(manager.target)).wait();

  if (process.env.FREEZER_ADDRESS) {
    if (admin !== deployer.address) {
      console.log("! ADMIN_ADDRESS bukan deployer: grant FREEZER_ROLE harus dilakukan admin secara manual.");
    } else {
      const FREEZER_ROLE = ethers.id("FREEZER_ROLE");
      await (await manager.grantRole(FREEZER_ROLE, process.env.FREEZER_ADDRESS)).wait();
      console.log(`FREEZER_ROLE → ${process.env.FREEZER_ADDRESS}`);
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
      PiutangForwarder: forwarder.target,
      DebtNote: debtNote.target,
      DebtManager: manager.target,
    },
    constructorArgs: {
      MockIDRX: [decimals, deployer.address, faucetAmount.toString()],
      PiutangForwarder: [],
      DebtNote: [],
      DebtManager: [debtNote.target, idrx.target, forwarder.target, admin],
    },
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${network.name}.json`), JSON.stringify(out, null, 2));

  console.log(out.contracts);
  console.log(`Disimpan di deployments/${network.name}.json`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
