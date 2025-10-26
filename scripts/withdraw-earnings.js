// Withdraw all paid invoice earnings from PaymentRegistry
require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const RPC_URL = process.env.RPC_URL;
const SELLER_PRIVATE_KEY = process.env.SELLER_PRIVATE_KEY;
const PAYMENT_REGISTRY_ADDRESS = process.env.PAYMENT_REGISTRY_ADDRESS;

const REGISTRY_ABI = [
  "function withdraw(bytes32 invoiceId) external",
  "function invoices(bytes32) view returns (address seller, address token, uint256 amount, bool paid)"
];

async function withdrawAllEarnings() {
  console.log('\n💰 Withdrawing seller earnings from PaymentRegistry...\n');

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const sellerWallet = new ethers.Wallet(SELLER_PRIVATE_KEY, provider);
  const registry = new ethers.Contract(PAYMENT_REGISTRY_ADDRESS, REGISTRY_ABI, sellerWallet);

  console.log(`Seller Address: ${sellerWallet.address}`);
  console.log(`Registry Address: ${PAYMENT_REGISTRY_ADDRESS}\n`);

  // Collect all invoice stores from all sellers
  const sellerDirs = [
    path.join(__dirname, '..', 'backend', 'sellers', 'petpainter'),
    path.join(__dirname, '..', 'backend', 'sellers', 'cartoonpup'),
    path.join(__dirname, '..', 'backend', 'sellers', 'modernartist')
  ];

  let totalWithdrawn = 0;
  let withdrawCount = 0;

  for (const sellerDir of sellerDirs) {
    const invoiceStorePath = path.join(sellerDir, 'invoiceStore.json');

    if (!fs.existsSync(invoiceStorePath)) {
      console.log(`⚠️  No invoice store found at ${invoiceStorePath}`);
      continue;
    }

    const invoiceStore = JSON.parse(fs.readFileSync(invoiceStorePath, 'utf8'));
    const sellerName = path.basename(sellerDir);

    console.log(`\n📂 Checking ${sellerName}...`);

    for (const [invoiceId, invoice] of Object.entries(invoiceStore)) {
      if (!invoice.paid) {
        console.log(`   ⏭️  Skipping ${invoiceId} - not paid`);
        continue;
      }

      // Check if this invoice belongs to the current seller wallet
      const idBytes = ethers.encodeBytes32String(invoiceId);

      try {
        const onChainInvoice = await registry.invoices(idBytes);

        if (onChainInvoice.seller.toLowerCase() !== sellerWallet.address.toLowerCase()) {
          console.log(`   ⏭️  Skipping ${invoiceId} - belongs to ${onChainInvoice.seller}`);
          continue;
        }

        if (onChainInvoice.amount === 0n) {
          console.log(`   ⏭️  Skipping ${invoiceId} - already withdrawn`);
          continue;
        }

        console.log(`   💸 Withdrawing ${invoiceId}...`);
        console.log(`      Amount: ${ethers.formatUnits(onChainInvoice.amount, 18)} ENC`);

        const tx = await registry.withdraw(idBytes);
        console.log(`      TX: ${tx.hash}`);

        const receipt = await tx.wait();
        console.log(`      ✅ Withdrawn successfully!`);

        totalWithdrawn += parseFloat(ethers.formatUnits(onChainInvoice.amount, 18));
        withdrawCount++;

      } catch (err) {
        console.log(`   ❌ Error withdrawing ${invoiceId}: ${err.message}`);
      }
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ Withdrawal complete!`);
  console.log(`   Total invoices withdrawn: ${withdrawCount}`);
  console.log(`   Total amount: ${totalWithdrawn.toFixed(1)} ENC`);
  console.log(`${'='.repeat(60)}\n`);
}

withdrawAllEarnings().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
