// backend/seller/index.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const { ethers } = require('ethers');

const app = express();
app.use(bodyParser.json());

// Paths & config
const path = require('path');
const STORE = path.join(__dirname, 'invoiceStore.json');
if (!fs.existsSync(STORE)) fs.writeFileSync(STORE, JSON.stringify({}));

const RPC_URL = process.env.RPC_URL;
const PAYMENT_REGISTRY_ADDRESS = process.env.PAYMENT_REGISTRY_ADDRESS;
const SELLER_PORT = process.env.SELLER_PORT || 3030;

// Ethers provider (read-only for verification)
if (!RPC_URL) {
  console.error('Missing RPC_URL in .env. Add your Arbitrum Sepolia RPC URL.');
  process.exit(1);
}
if (!PAYMENT_REGISTRY_ADDRESS) {
  console.error('Missing PAYMENT_REGISTRY_ADDRESS in .env. Add your deployed PaymentRegistry address.');
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);

// Minimal ABI for reading the invoice struct and for events (if you later want to listen)
const REGISTRY_ABI = [
  // getter for mapping: invoices(bytes32) returns (address seller, address token, uint256 amount, bool paid)
  "function invoices(bytes32) view returns (address seller, address token, uint256 amount, bool paid)",
  "event InvoicePaid(bytes32 indexed invoiceId, address indexed buyer, address indexed seller, address token, uint256 amount)",
  "event InvoiceCreated(bytes32 indexed invoiceId, address indexed seller, address token, uint256 amount)"
];

const registry = new ethers.Contract(PAYMENT_REGISTRY_ADDRESS, REGISTRY_ABI, provider);

// helper: load / save invoice store
function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE));
  } catch (e) {
    return {};
  }
}
function saveStore(db) {
  fs.writeFileSync(STORE, JSON.stringify(db, null, 2));
}

// Create invoice endpoint (local store only)
// Use this to add invoices in the local DB (it does NOT create them on-chain here)
app.post('/create-invoice', async (req, res) => {
  const { invoiceId, amount, token } = req.body;
  if (!invoiceId || !amount || !token) return res.status(400).json({ error: 'invoiceId, amount, token required' });
  const db = loadStore();
  db[invoiceId] = { invoiceId, amount, token, createdAt: Date.now(), paid: false };
  saveStore(db);
  return res.json({ ok: true, invoice: db[invoiceId] });
});

// Mark paid (manual helper) - still useful for demos
app.post('/mark-paid', (req, res) => {
  const { invoiceId } = req.body;
  if (!invoiceId) return res.status(400).json({ error: 'invoiceId required' });
  const db = loadStore();
  if (!db[invoiceId]) return res.status(404).json({ error: 'unknown invoice' });
  db[invoiceId].paid = true;
  saveStore(db);
  return res.json({ ok: true });
});

// GET resource: respond with 402 invoice if unpaid, or resource if paid.
// This implementation verifies paid status on-chain by reading PaymentRegistry.invoices(bytes32).
app.get('/resource/:id', async (req, res) => {
  const id = req.params.id;
  const db = loadStore();
  const local = db[id];

  // If local invoice isn't present, we still support returning a minimal invoice shape from on-chain (if possible).
  // But typically you create the invoice on-chain *and* in local store using register-onchain script.
  if (!local) {
    return res.status(404).json({ error: 'not found' });
  }

  try {
    // Use the same bytes32 encoding you used when creating the invoice.
    // In the PoC we used ethers.encodeBytes32String when registering on-chain.
    const idBytes = ethers.encodeBytes32String(id);

    // Read the on-chain invoice struct
    const onchain = await registry.invoices(idBytes);
    // onchain comes as an array-like: [seller, token, amount, paid]
    // In ethers v6 it will be an object we can read by properties too
    const paid = onchain && (onchain.paid === true || onchain[3] === true);

    // If paid on-chain, mark local store and return resource
    if (paid) {
      // update local DB (optional)
      db[id].paid = true;
      saveStore(db);

      // return the unlocked resource
      return res.json({
        ok: true,
        paid: true,
        invoiceId: id,
        data: `secret-data-for-${id}`
      });
    } else {
      // not paid on-chain -> return x402-style invoice JSON (402)
      return res.status(402).json({
        invoiceId: local.invoiceId,
        amount: local.amount,
        token: local.token,
        registry: PAYMENT_REGISTRY_ADDRESS,
        message: 'Payment required. Use x402/AP2-compatible flow.'
      });
    }
  } catch (err) {
    console.error('Error checking on-chain invoice:', err);
    // fallback: return the local invoice as unpaid
    return res.status(402).json({
      invoiceId: local.invoiceId,
      amount: local.amount,
      token: local.token,
      registry: PAYMENT_REGISTRY_ADDRESS,
      message: 'Payment required (verification failed, returned local invoice).'
    });
  }
});

app.listen(SELLER_PORT, () => console.log('Seller agent running on port', SELLER_PORT));
