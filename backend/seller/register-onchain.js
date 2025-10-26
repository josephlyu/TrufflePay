require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");

async function main() {
  const invoiceId = process.argv[2];
  if (!invoiceId) throw new Error("Usage: node register-onchain.js <invoiceId>");

  console.log(`🧾 Registering invoice ${invoiceId} on-chain...`);

  const RPC_URL = process.env.RPC_URL;
  const PRIVATE_KEY = (process.env.SELLER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY).trim();
  const PAYMENT_REGISTRY_ADDRESS = process.env.PAYMENT_REGISTRY_ADDRESS;
  const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
  const AMOUNT = "1";

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  const registry = new ethers.Contract(
    PAYMENT_REGISTRY_ADDRESS,
    [
      "function invoices(bytes32) view returns (address seller, address token, uint256 amount, bool paid)",
      "function createInvoice(bytes32,address,uint256) external"
    ],
    wallet
  );

  const idBytes = ethers.encodeBytes32String(invoiceId);

  const existing = await registry.invoices(idBytes);
  if (existing && existing.seller !== ethers.ZeroAddress) {
    console.log("⚠️ Invoice already exists on-chain. Skipping registration.");
  } else {
    const tx = await registry.createInvoice(idBytes, TOKEN_ADDRESS, ethers.parseUnits(AMOUNT, 18));
    await tx.wait();
    console.log(`✅ Invoice registered: ${tx.hash}`);
  }

  const storePath = "./backend/seller/invoiceStore.json";
  let store = {};
  if (fs.existsSync(storePath)) {
    store = JSON.parse(fs.readFileSync(storePath));
  }
  store[invoiceId] = {
    invoiceId,
    amount: AMOUNT,
    token: TOKEN_ADDRESS,
    registry: PAYMENT_REGISTRY_ADDRESS,
    seller: wallet.address,
    paid: false
  };
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2));

  console.log(`🗃️ Saved invoice ${invoiceId} locally to invoiceStore.json`);
}

main().catch((err) => console.error(err));
