// Deploy PetPortraitNFT contract to Arbitrum Sepolia
require('dotenv').config();
const hre = require("hardhat");
const fs = require('fs');
const path = require('path');

async function main() {
  console.log("\n🎨 Deploying PetPortraitNFT contract to Arbitrum Sepolia...\n");

  // Get deployer account
  const [deployer] = await hre.ethers.getSigners();
  console.log(`   Deployer address: ${deployer.address}`);

  // Get deployer balance
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`   Deployer balance: ${hre.ethers.formatEther(balance)} ETH\n`);

  // Deploy PetPortraitNFT
  console.log("   Deploying PetPortraitNFT...");
  const PetPortraitNFT = await hre.ethers.getContractFactory("PetPortraitNFT");
  const nft = await PetPortraitNFT.deploy(deployer.address);
  await nft.waitForDeployment();

  const nftAddress = await nft.getAddress();
  console.log(`   ✅ PetPortraitNFT deployed to: ${nftAddress}\n`);

  // Save deployment info
  const deploymentInfo = {
    network: "arbitrum-sepolia",
    nftContract: nftAddress,
    deployer: deployer.address,
    deployedAt: new Date().toISOString()
  };

  const envPath = path.join(__dirname, '..', '.env');
  let envContent = '';

  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }

  // Update or add NFT_CONTRACT_ADDRESS
  if (envContent.includes('NFT_CONTRACT_ADDRESS=')) {
    envContent = envContent.replace(/NFT_CONTRACT_ADDRESS=.*/,`NFT_CONTRACT_ADDRESS=${nftAddress}`);
  } else {
    envContent += `\nNFT_CONTRACT_ADDRESS=${nftAddress}\n`;
  }

  fs.writeFileSync(envPath, envContent);
  console.log(`   📝 Updated .env with NFT_CONTRACT_ADDRESS=${nftAddress}\n`);

  // Save full deployment info
  const deploymentPath = path.join(__dirname, '..', 'nft-deployment.json');
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`   📄 Saved deployment info to nft-deployment.json\n`);

  console.log("🎉 NFT Contract Deployment Complete!\n");
  console.log(`   Contract: ${nftAddress}`);
  console.log(`   Explorer: https://sepolia.arbiscan.io/address/${nftAddress}`);
  console.log(`   Owner: ${deployer.address}\n`);

  console.log("📋 Next Steps:");
  console.log("   1. The NFT contract address has been saved to .env");
  console.log("   2. ModernArtist will mint NFTs when delivering portraits");
  console.log("   3. Buyers will receive both artwork AND an NFT\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
