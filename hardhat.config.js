require("dotenv").config();
require("@nomicfoundation/hardhat-ethers");

module.exports = {
  solidity: {
    compilers: [
      { version: "0.8.17" },
      { version: "0.8.20" }
    ]
  },
  networks: {
    arbitrumSepolia: {
      url: process.env.RPC_URL || "https://arb-sepolia.g.alchemy.com/v2/YOUR_KEY",
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : []
    }
  }
};
