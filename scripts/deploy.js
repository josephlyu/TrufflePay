const hre = require("hardhat");

async function main() {
  const Registry = await hre.ethers.getContractFactory("PaymentRegistry");
  const registry = await Registry.deploy();

  // Ethers v6 — wait for deployment
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  console.log("PaymentRegistry deployed to:", address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
