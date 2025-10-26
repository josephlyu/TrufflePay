require("dotenv").config();
const { ethers } = require("ethers");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

async function main() {
  console.log("🤖 Buyer agent starting...");

  // ---- 1. Fetch invoice from seller ----
  const invoiceId = process.argv[2] || "inv-1";
  const sellerUrl = process.env.SELLER_URL || "http://localhost:3030";
  console.log(`📝 Requesting invoice: ${invoiceId}`);
  const res = await fetch(`${sellerUrl}/resource/${invoiceId}`);
  const invoice = await res.json();
  console.log("Fetched invoice:", invoice);

  if (invoice.error) throw new Error(`Invoice not found: ${invoice.error}`);

  // ---- 2. Prepare connection + wallet ----
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const buyerWallet = new ethers.Wallet(
    (process.env.BUYER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY).trim(),
    provider
  );

  // ---- 3. Extract and validate addresses ----
  const tokenAddress = invoice.token || invoice.tokenAddress;
  const registryAddress =
    invoice.registry || invoice.paymentRegistry || invoice.registryAddress;

  if (!ethers.isAddress(tokenAddress)) throw new Error(`Invalid token address: ${tokenAddress}`);
  if (!ethers.isAddress(registryAddress))
    throw new Error(`Invalid registry address: ${registryAddress}`);

  console.log("Token address:", tokenAddress);
  console.log("Registry address:", registryAddress);
  console.log("Buyer wallet:", buyerWallet.address);

  // ---- 4. Load contracts ----
  const token = new ethers.Contract(
    tokenAddress,
    [
      "function approve(address spender, uint256 amount) public returns (bool)",
      "function allowance(address owner, address spender) public view returns (uint256)"
    ],
    buyerWallet
  );

  const registry = new ethers.Contract(
    registryAddress,
    [
      "function payInvoice(bytes32 invoiceId) external",
      "event InvoicePaid(bytes32 indexed invoiceId, address indexed payer)"
    ],
    buyerWallet
  );

  // ---- 5. Approve + pay ----
  const idBytes = ethers.encodeBytes32String(invoice.invoiceId);
  const amount = ethers.parseUnits(invoice.amount, 18);

  console.log("💰 Approving token transfer to registry:", registryAddress);
  const approveTx = await token.approve(registryAddress, amount);
  await approveTx.wait();
  console.log("✅ Approval confirmed:", approveTx.hash);

  console.log("💸 Paying invoice on-chain...");
  const payTx = await registry.payInvoice(idBytes);
  await payTx.wait();
  console.log("✅ Payment confirmed:", payTx.hash);

  console.log(`✅ Invoice ${invoice.invoiceId} paid successfully!`);
}

main().catch((err) => {
  console.error("❌ Error:", err.message || err);
});
