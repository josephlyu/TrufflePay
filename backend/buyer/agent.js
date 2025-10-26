// backend/buyer/agent.js
// INTELLIGENT AI Buyer Agent with Semantic Matching and Budget Negotiation
// Sends dog photo, analyzes requirements, pays for AI portrait, receives styled image
require('dotenv').config();
const { ethers } = require('ethers');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// ===== Configuration =====
const RPC_URL = process.env.RPC_URL;
const BUYER_PRIVATE_KEY = process.env.BUYER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const REGISTRY_PATH = path.join(__dirname, '..', 'services', 'registry.json');
const IMAGE_PATH = 'assets/truffle.jpg';
const OUTPUT_DIR = 'out';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'portrait.png');

// ===== Validate Prerequisites =====
if (!RPC_URL || !BUYER_PRIVATE_KEY) {
  console.error('❌ Missing RPC_URL or BUYER_PRIVATE_KEY in .env');
  process.exit(1);
}

if (!OPENAI_API_KEY) {
  console.error('❌ Missing OPENAI_API_KEY in .env');
  process.exit(1);
}

if (!fs.existsSync(IMAGE_PATH)) {
  console.error(`❌ Dog photo not found at ${IMAGE_PATH}`);
  process.exit(1);
}

if (!fs.existsSync(REGISTRY_PATH)) {
  console.error(`❌ Registry not found at ${REGISTRY_PATH}`);
  process.exit(1);
}

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// ===== Initialize OpenAI =====
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ===== Load Registry =====
function loadRegistry() {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  } catch (err) {
    console.error('❌ Failed to load registry:', err.message);
    process.exit(1);
  }
}

// ===== INTELLIGENT SELLER SELECTION with GPT-4 =====
// Uses semantic matching to find best seller based on natural language requirements
async function selectSellerIntelligently(registry, userRequirements) {
  try {
    console.log('\n🤖 AI Agent analyzing your requirements...');
    console.log(`   Requirements: "${userRequirements}"`);

    // Prepare seller information for GPT-4
    const sellersInfo = registry.map((s, idx) => `
Seller ${idx + 1}: ${s.name}
  - ID: ${s.id}
  - Style: ${s.style}
  - Price: ${s.price} ${s.token}
  - Description: ${s.description}
  - Specialties: ${s.specialties.join(', ')}
  - Target Audience: ${s.targetAudience}
`).join('\n');

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an AI buyer agent helping to select the best art service provider. Analyze the user's requirements and match them with available sellers based on:
1. Style preferences (exact or semantic match)
2. Budget constraints (must be within budget, but willing to pay more for better match)
3. Quality expectations
4. Target use case

Return ONLY a JSON object with this exact structure:
{
  "selectedSellerId": "the seller id",
  "reasoning": "brief explanation of why this seller was chosen",
  "budgetJustification": "why the price is worth it"
}`
        },
        {
          role: "user",
          content: `User Requirements: ${userRequirements}

Available Sellers:
${sellersInfo}

Select the BEST seller that matches the user's needs. Consider semantic meaning, not just keywords. If user mentions "modern" or "contemporary", match those concepts even if worded differently.`
        }
      ],
      temperature: 0.3, // Lower temperature for more consistent decisions
      response_format: { type: "json_object" }
    });

    const decision = JSON.parse(response.choices[0].message.content);
    console.log(`\n💡 AI Decision: ${decision.reasoning}`);
    console.log(`   Budget Analysis: ${decision.budgetJustification}`);

    const selectedSeller = registry.find(s => s.id === decision.selectedSellerId);

    if (!selectedSeller) {
      console.warn('⚠️  AI selected invalid seller, falling back to first seller');
      return { seller: registry[0], decision };
    }

    return { seller: selectedSeller, decision };

  } catch (err) {
    console.error('❌ AI selection failed:', err.message);
    console.log('   Falling back to first available seller');
    return { seller: registry[0], decision: { reasoning: 'Fallback due to AI error' } };
  }
}

// ===== Encode Image to Base64 =====
function encodeImageToBase64(imagePath) {
  console.log(`📷 Reading image from: ${imagePath}`);
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');
  const stats = fs.statSync(imagePath);
  console.log(`   File size: ${(stats.size / 1024).toFixed(2)} KB`);
  return base64Image;
}

// ===== Download Image from URL =====
async function downloadImage(url, outputPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(outputPath);

    protocol.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download image: ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(outputPath);
      });
    }).on('error', (err) => {
      fs.unlink(outputPath, () => {});
      reject(err);
    });
  });
}

// ===== Pay Invoice On-Chain =====
async function payInvoice(invoice, buyerWallet) {
  try {
    console.log('\n💰 Processing blockchain payment...');
    console.log(`   Invoice ID: ${invoice.invoiceId}`);
    console.log(`   Amount: ${invoice.amount} ENC`);
    console.log(`   Token: ${invoice.token}`);
    console.log(`   Registry: ${invoice.registry}`);

    const token = new ethers.Contract(
      invoice.token,
      [
        "function approve(address spender, uint256 amount) public returns (bool)",
        "function allowance(address owner, address spender) public view returns (uint256)"
      ],
      buyerWallet
    );

    const registry = new ethers.Contract(
      invoice.registry,
      ["function payInvoice(bytes32 invoiceId) external"],
      buyerWallet
    );

    const amount = ethers.parseUnits(invoice.amount, 18);
    const idBytes = ethers.encodeBytes32String(invoice.invoiceId);

    console.log('   📝 Approving token transfer...');
    const approveTx = await token.approve(invoice.registry, amount);
    await approveTx.wait();
    console.log(`   ✅ Approved: ${approveTx.hash}`);

    console.log('   💸 Paying invoice on Arbitrum Sepolia...');
    const payTx = await registry.payInvoice(idBytes);
    await payTx.wait();
    console.log(`   ✅ Payment confirmed: ${payTx.hash}`);

    return { success: true, txHash: payTx.hash };
  } catch (err) {
    console.error('   ❌ Payment failed:', err.message);
    throw err;
  }
}

// ===== Request Portrait from Seller =====
async function requestPortrait(seller, imageBase64, invoiceId = null) {
  const url = `${seller.endpoint}/generate`;

  const payload = {
    imageBase64: imageBase64,
    style: seller.style,
    description: "Create a professional portrait suitable for printing and framing"
  };

  if (invoiceId) {
    payload.invoiceId = invoiceId;
  }

  console.log(`\n🎨 Requesting portrait from ${seller.name}...`);
  console.log(`   Endpoint: ${url}`);
  console.log(`   Style: ${seller.style}`);
  console.log(`   Price: ${seller.price} ENC`);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  return { status: response.status, data };
}

// ===== Main Buyer Agent Logic =====
async function main() {
  console.log('\n🤖 INTELLIGENT AI Buyer Agent Starting...');
  console.log('═'.repeat(70));

  // Get user requirements from command line or use default
  let userRequirements = process.argv.slice(2).join(' ');

  if (!userRequirements) {
    // Default requirements for testing
    userRequirements = "I want a printable art portrait for my dog, my budget is 1 ENC, but in particular I am looking for modern contemporary art. If there are such providers I'm happy to pay up to 2 ENC.";
    console.log('\n📝 No requirements specified, using default:');
    console.log(`   "${userRequirements}"`);
  } else {
    console.log(`\n📝 Your requirements:`);
    console.log(`   "${userRequirements}"`);
  }

  // Load available sellers
  console.log('\n📋 Step 1: Discovering available AI artists...');
  const registry = loadRegistry();
  console.log(`   Found ${registry.length} seller(s) in marketplace`);

  // Display all available options
  console.log('\n   Available Artists:');
  registry.forEach((s, idx) => {
    console.log(`   ${idx + 1}. ${s.name} - ${s.style} style - ${s.price} ENC`);
  });

  // Use AI to intelligently select best seller
  console.log('\n🧠 Step 2: AI analyzing and selecting best match...');
  const { seller, decision } = await selectSellerIntelligently(registry, userRequirements);

  console.log(`\n✅ Selected: ${seller.name}`);
  console.log(`   Style: ${seller.style}`);
  console.log(`   Price: ${seller.price} ENC`);
  console.log(`   Match Quality: ${decision.reasoning || 'Based on requirements'}`);

  // Encode dog photo
  console.log('\n📷 Step 3: Preparing dog photo...');
  const imageBase64 = encodeImageToBase64(IMAGE_PATH);
  console.log('   ✅ Image encoded successfully');

  // Initialize wallet
  console.log('\n💼 Step 4: Initializing wallet...');
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const buyerWallet = new ethers.Wallet(BUYER_PRIVATE_KEY, provider);
  console.log(`   Buyer Address: ${buyerWallet.address}`);

  // Request portrait (expecting 402)
  console.log('\n🎨 Step 5: Requesting AI portrait generation...');
  let response = await requestPortrait(seller, imageBase64);

  // Handle 402 Payment Required
  if (response.status === 402) {
    console.log('   📄 Received HTTP 402 Payment Required');
    const invoice = response.data;

    console.log('\n💳 Step 6: Processing payment via AP2 protocol...');
    await payInvoice(invoice, buyerWallet);

    console.log('\n🔄 Step 7: Retrying request after payment...');
    response = await requestPortrait(seller, imageBase64, invoice.invoiceId);
  }

  // Handle success
  if (response.status === 200) {
    const result = response.data;
    console.log('\n✅ Step 8: Portrait generation complete!');
    console.log(`   Artist: ${result.seller}`);
    console.log(`   Style: ${result.style}`);
    console.log(`   Quality: ${result.quality || 'High quality'}`);

    console.log('\n💾 Step 9: Downloading your portrait...');
    await downloadImage(result.portraitUrl, OUTPUT_FILE);
    console.log(`   ✅ Saved to: ${OUTPUT_FILE}`);

    if (result.ap2Receipt) {
      console.log('\n🧾 Step 10: AP2 Payment Receipt');
      console.log('   ' + '─'.repeat(60));
      console.log(`   Invoice ID: ${result.ap2Receipt.invoiceId}`);
      console.log(`   Amount Paid: ${result.ap2Receipt.amount} ENC`);
      console.log(`   Token: ${result.ap2Receipt.token}`);
      console.log(`   Paid At: ${new Date(result.ap2Receipt.paidAt).toISOString()}`);
      console.log('   ' + '─'.repeat(60));
    }

    console.log('\n🎉 SUCCESS! Your AI negotiation completed!');
    console.log('═'.repeat(70));
    console.log(`\n💡 What Happened:`);
    console.log(`   ✓ AI analyzed your requirements: "${userRequirements.substring(0, 80)}..."`);
    console.log(`   ✓ Semantically matched with: ${seller.name} (${seller.style})`);
    console.log(`   ✓ Paid ${seller.price} ENC on Arbitrum Sepolia`);
    console.log(`   ✓ Received ${result.quality || 'high-quality'} portrait`);
    console.log(`\n📸 View your portrait: ${OUTPUT_FILE}`);
    console.log(`\n🏆 This demonstrates true AI-to-AI negotiation and commerce!\n`);

  } else {
    console.error('\n❌ Unexpected response:', response);
    process.exit(1);
  }
}

// ===== Run Agent =====
main().catch((err) => {
  console.error('\n❌ Agent failed:', err.message);
  process.exit(1);
});
