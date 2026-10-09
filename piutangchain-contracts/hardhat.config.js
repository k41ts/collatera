require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

const SOLC_VERSION = "0.8.28";

// Opsional: kompilasi pakai solcjs dari npm (berguna kalau binary compiler tidak bisa diunduh,
// misalnya di CI/sandbox dengan jaringan terbatas). Aktifkan dengan SOLCJS=1 dan `npm i --no-save solc@0.8.28`.
if (process.env.SOLCJS === "1") {
  const { subtask } = require("hardhat/config");
  const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");
  subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
    if (args.solcVersion !== SOLC_VERSION) return runSuper();
    const solc = require("solc");
    return {
      compilerPath: require.resolve("solc/soljson.js"),
      isSolcJs: true,
      version: args.solcVersion,
      longVersion: solc.version(),
    };
  });
}

const { SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, ETHERSCAN_API_KEY } = process.env;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: SOLC_VERSION,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {},
    ...(SEPOLIA_RPC_URL && DEPLOYER_PRIVATE_KEY
      ? { sepolia: { url: SEPOLIA_RPC_URL, accounts: [DEPLOYER_PRIVATE_KEY], chainId: 11155111 } }
      : {}),
  },
  etherscan: { apiKey: ETHERSCAN_API_KEY || "" },
  gasReporter: { enabled: process.env.REPORT_GAS === "1", currency: "USD" },
};
