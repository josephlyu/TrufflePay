// Transfer NFT contract ownership to seller wallet
require('dotenv').config();
const hre = require("hardhat");

async function main() {
  const NFT_CONTRACT = process.env.NFT_CONTRACT_ADDRESS;
  const SELLER_ADDRESS = process.env.SELLER_PRIVATE_KEY
    ? new hre.ethers.Wallet(process.env.SELLER_PRIVATE_KEY).address
    : process.env.DEPLOYER_PRIVATE_KEY
      ? new hre.ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY).address
      : null;

  if (!NFT_CONTRACT) {
    console.error("❌ NFT_CONTRACT_ADDRESS not found in .env");
    process.exit(1);
  }

  if (!SELLER_ADDRESS) {
    console.error("❌ SELLER_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY not found in .env");
    process.exit(1);
  }

  console.log("\n🔐 Transferring NFT Contract Ownership...\n");
  console.log(`   NFT Contract: ${NFT_CONTRACT}`);
  console.log(`   New Owner (Seller): ${SELLER_ADDRESS}\n`);

  const [deployer] = await hre.ethers.getSigners();
  const PetPortraitNFT = await hre.ethers.getContractFactory("PetPortraitNFT");
  const nft = PetPortraitNFT.attach(NFT_CONTRACT);

  // Check current owner
  const currentOwner = await nft.owner();
  console.log(`   Current owner: ${currentOwner}`);

  if (currentOwner.toLowerCase() === SELLER_ADDRESS.toLowerCase()) {
    console.log("   ✅ Seller is already the owner!\n");
    return;
  }

  // Transfer ownership
  console.log("   Transferring ownership...");
  const tx = await nft.connect(deployer).transferOwnership(SELLER_ADDRESS);
  await tx.wait();

  console.log(`   ✅ Ownership transferred!`);
  console.log(`   Transaction: ${tx.hash}\n`);

  // Verify
  const newOwner = await nft.owner();
  console.log(`   New owner: ${newOwner}`);
  console.log("\n🎉 ModernArtist can now mint NFTs!\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
