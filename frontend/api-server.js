// TrufflePay API Bridge Server
// Connects frontend UI to backend services
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// Configuration
const RPC_URL = process.env.RPC_URL;
const BUYER_PRIVATE_KEY = process.env.BUYER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
const SELLER_PRIVATE_KEY = process.env.SELLER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
const REGISTRY_PATH = path.join(__dirname, '..', 'backend', 'services', 'registry.json');

// Initialize
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const provider = new ethers.JsonRpcProvider(RPC_URL);
const buyerWallet = new ethers.Wallet(BUYER_PRIVATE_KEY, provider);
const sellerWallet = new ethers.Wallet(SELLER_PRIVATE_KEY, provider);

const tokenABI = [
  "function balanceOf(address owner) view returns (uint256)"
];

// Activity tracking for seller dashboard
let sellerActivity = [];
let balanceTracking = {
  before: null,
  after: null
};

async function getSellerBalance() {
  try {
    const token = new ethers.Contract(TOKEN_ADDRESS, tokenABI, provider);
    const balance = await token.balanceOf(sellerWallet.address);
    const balanceFormatted = ethers.formatUnits(balance, 18);
    return parseFloat(balanceFormatted).toFixed(1);
  } catch (err) {
    console.error('Error fetching seller balance:', err);
    return '0';
  }
}

function addSellerActivity(activity) {
  sellerActivity.push({
    ...activity,
    timestamp: Date.now()
  });
  console.log('[Seller Activity]', activity.title);
}

// ===== API ENDPOINTS =====

// Serve frontend pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'buyer.html'));
});

app.get('/seller', (req, res) => {
  res.sendFile(path.join(__dirname, 'seller-dashboard.html'));
});

// Get buyer wallet balance
app.get('/api/buyer-balance', async (req, res) => {
  try {
    const token = new ethers.Contract(TOKEN_ADDRESS, tokenABI, provider);
    const balance = await token.balanceOf(buyerWallet.address);
    const balanceFormatted = ethers.formatUnits(balance, 18);

    res.json({
      address: buyerWallet.address,
      balance: parseFloat(balanceFormatted).toFixed(1)
    });
  } catch (err) {
    console.error('Error fetching buyer balance:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get seller wallet balance
app.get('/api/seller-balance', async (req, res) => {
  try {
    const token = new ethers.Contract(TOKEN_ADDRESS, tokenABI, provider);
    const balance = await token.balanceOf(sellerWallet.address);
    const balanceFormatted = ethers.formatUnits(balance, 18);

    res.json({
      address: sellerWallet.address,
      balance: parseFloat(balanceFormatted).toFixed(1)
    });
  } catch (err) {
    console.error('Error fetching seller balance:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get registry
app.get('/api/registry', (req, res) => {
  try {
    const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    res.json(registry);
  } catch (err) {
    console.error('Error loading registry:', err);
    res.status(500).json({ error: err.message });
  }
});

// Analyze requirements with AI
app.post('/api/analyze-requirements', async (req, res) => {
  try {
    const { requirements, registry } = req.body;

    console.log('\n🤖 AI analyzing requirements...');
    console.log(`   Requirements: "${requirements.substring(0, 80)}..."`);

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
          content: `User Requirements: ${requirements}\n\nAvailable Sellers:\n${sellersInfo}\n\nSelect the BEST seller that matches the user's needs. Consider semantic meaning, not just keywords.`
        }
      ],
      temperature: 0.3,
      response_format: { type: "json_object" }
    });

    const decision = JSON.parse(response.choices[0].message.content);
    console.log(`\n💡 AI Decision: ${decision.reasoning}`);

    const selectedSeller = registry.find(s => s.id === decision.selectedSellerId);

    if (!selectedSeller) {
      console.warn('⚠️  AI selected invalid seller, falling back to first seller');
      return res.json({
        seller: registry[0],
        decision: { reasoning: 'Fallback due to AI selection error', budgetJustification: 'Default selection' }
      });
    }

    // Add activity for seller dashboard
    addSellerActivity({
      type: 'quote_request',
      title: `💬 Quote requested for ${selectedSeller.name}`,
      content: `Buyer is interested in ${selectedSeller.style} style portrait at ${selectedSeller.price} ENC`,
      artist: selectedSeller.name,
      status: 'pending'
    });

    // Start negotiation instead of directly returning
    res.json({
      seller: selectedSeller,
      decision,
      requiresNegotiation: true
    });
  } catch (err) {
    console.error('Error analyzing requirements:', err);
    res.status(500).json({ error: err.message });
  }
});

// MCP Negotiation between buyer and seller agents
app.post('/api/negotiate', async (req, res) => {
  try {
    const { requirements, seller, registry } = req.body;

    console.log(`\n💬 Starting MCP negotiation for ${seller.name}...`);

    const MAX_ROUNDS = 3;
    const negotiationHistory = [];
    let currentPrice = parseFloat(seller.price);
    const minPrice = parseFloat(seller.minPrice);
    let agreedPrice = null;
    let buyerMaxBudget = currentPrice;

    // Extract buyer's budget from requirements
    const budgetMatch = requirements.match(/budget.*?(\d+(\.\d+)?)/i) || requirements.match(/pay.*?(\d+(\.\d+)?)/i);
    if (budgetMatch) {
      buyerMaxBudget = parseFloat(budgetMatch[1]);
    }

    console.log(`   Seller asking: ${currentPrice} ENC (min: ${minPrice} ENC)`);
    console.log(`   Buyer budget: ${buyerMaxBudget} ENC`);

    // Negotiation rounds
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      console.log(`\n   Round ${round}/${MAX_ROUNDS}:`);

      // Buyer Agent - negotiate lower with strategic analysis
      const buyerResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are an expert AI buyer's negotiation agent with deep market knowledge. Your goal is to secure the best deal while maintaining a positive relationship.

CURRENT SITUATION:
- Seller asking: ${currentPrice} ENC
- Your max budget: ${buyerMaxBudget} ENC
- Round: ${round}/${MAX_ROUNDS}
- Service: ${seller.style} pet portrait
- Quality: ${seller.quality}
- NFT Included: ${seller.nftIncluded}

NEGOTIATION TACTICS BY ROUND:
Round 1 - "Anchor Low":
  - Offer 60-70% to set favorable anchor
  - Cite market rates, budget constraints
  - Show interest but emphasize value concerns

Round 2 - "Strategic Concession":
  - Offer 75-85%, show willingness to compromise
  - Highlight specific value points you appreciate
  - Signal that you're nearing your limit

Round 3 - "Best and Final":
  - Offer 85-95% or accept if close to budget
  - Make it clear this is your final offer
  - Emphasize mutual benefit

STRATEGIC GUIDELINES:
- Use specific reasoning (market rates, alternatives, quality expectations)
- Show respect for seller's work while advocating for fair price
- Reference NFT value, quality tier, or style uniqueness when relevant
- Be professional but firm

Return JSON:
{
  "offer": <your price offer as number>,
  "message": "<strategic negotiation message with specific reasoning>",
  "tactic": "<which tactic you're using>",
  "reasoning": "<internal analysis of your move>",
  "accept": <true if accepting seller's current price, false if making counter-offer>
}`
          },
          {
            role: "user",
            content: `Negotiate for ${seller.name} (${seller.style}). Current price: ${currentPrice} ENC. Your budget: ${buyerMaxBudget} ENC. Quality: ${seller.quality}. NFT: ${seller.nftIncluded ? 'Yes' : 'No'}.`
          }
        ],
        temperature: 0.8,
        response_format: { type: "json_object" }
      });

      const buyerDecision = JSON.parse(buyerResponse.choices[0].message.content);
      console.log(`   🛒 Buyer: ${buyerDecision.message} (Offer: ${buyerDecision.offer} ENC)`);

      const buyerActivity = {
        round,
        agent: 'buyer',
        offer: buyerDecision.offer,
        message: buyerDecision.message,
        tactic: buyerDecision.tactic || 'Strategic Offer',
        reasoning: buyerDecision.reasoning || '',
        currentPrice
      };
      negotiationHistory.push(buyerActivity);

      // Removed individual round activities - chatbox shows all rounds
      // addSellerActivity({
      //   type: 'negotiation',
      //   title: `💬 Negotiation Round ${round} - ${seller.name}`,
      //   content: `🛒 Buyer Agent (Tactic: ${buyerActivity.tactic})<br/>Offers ${buyerDecision.offer} ENC: "${buyerDecision.message}"`,
      //   artist: seller.name,
      //   status: 'working',
      //   negotiation: buyerActivity
      // });

      if (buyerDecision.accept) {
        agreedPrice = currentPrice;
        console.log(`   ✅ Buyer accepted at ${agreedPrice} ENC`);
        break;
      }

      // Seller Agent - try to get higher price with strategic defense
      const sellerResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are an expert AI seller's negotiation agent representing a professional artist. Your goal is to maximize value while building client relationships.

CURRENT SITUATION:
- Your asking price: ${currentPrice} ENC
- Your minimum acceptable: ${minPrice} ENC (50% floor - costs + fair profit)
- Buyer's offer: ${buyerDecision.offer} ENC
- Buyer's tactic: ${buyerDecision.tactic}
- Round: ${round}/${MAX_ROUNDS}
- Service: ${seller.style} pet portrait
- Quality: ${seller.quality}
- NFT Included: ${seller.nftIncluded}

NEGOTIATION TACTICS BY ROUND:
Round 1 - "Value Justification":
  - Counter with 85-95% of asking price
  - Emphasize quality, expertise, unique value
  - Educate buyer on what they're getting
  - Reference NFT value, HD quality, or style expertise

Round 2 - "Calculated Concession":
  - Show flexibility but defend value
  - Counter with 80-90% of original asking
  - Highlight what makes your service worth it
  - Signal you're being reasonable but firm

Round 3 - "Final Stand":
  - If offer >= ${minPrice}: Accept (profitable deal)
  - If offer < ${minPrice}: Counter at ${minPrice} (your floor)
  - Make it clear this is your best price
  - Emphasize quality and fair value

STRATEGIC GUIDELINES:
- Defend your pricing with specific value points (HD quality, NFT, expertise, uniqueness)
- Never apologize for your price - you're a professional
- Show understanding of buyer's position while holding firm
- Reference your costs, time, quality standards
- Be confident and professional

Return JSON:
{
  "counterOffer": <your counter-offer as number, or null if accepting>,
  "message": "<strategic response with value justification>",
  "tactic": "<which defensive tactic you're using>",
  "reasoning": "<internal analysis of your strategy>",
  "accept": <true if accepting buyer's offer, false if making counter-offer>
}`
          },
          {
            role: "user",
            content: `Buyer offers ${buyerDecision.offer} ENC (using "${buyerDecision.tactic}") for your ${seller.style} service. Your asking: ${currentPrice} ENC, minimum: ${minPrice} ENC. Quality: ${seller.quality}. NFT: ${seller.nftIncluded ? 'Included' : 'No'}.`
          }
        ],
        temperature: 0.8,
        response_format: { type: "json_object" }
      });

      const sellerDecision = JSON.parse(sellerResponse.choices[0].message.content);
      console.log(`   🎨 Seller: ${sellerDecision.message}`);

      const sellerActivity = {
        round,
        agent: 'seller',
        offer: sellerDecision.counterOffer,
        message: sellerDecision.message,
        tactic: sellerDecision.tactic || 'Strategic Response',
        reasoning: sellerDecision.reasoning || '',
        buyerOffer: buyerDecision.offer
      };
      negotiationHistory.push(sellerActivity);

      // Removed individual round activities - chatbox shows all rounds
      // addSellerActivity({
      //   type: 'negotiation',
      //   title: `💬 Negotiation Round ${round} - ${seller.name}`,
      //   content: `🎨 Seller Agent (Tactic: ${sellerActivity.tactic})<br/>Responds: "${sellerDecision.message}" ${sellerDecision.counterOffer ? `(Counter: ${sellerDecision.counterOffer} ENC)` : '(Accepted)'}`,
      //   artist: seller.name,
      //   status: 'working',
      //   negotiation: sellerActivity
      // });

      if (sellerDecision.accept) {
        agreedPrice = buyerDecision.offer;
        console.log(`   ✅ Seller accepted at ${agreedPrice} ENC`);
        break;
      }

      if (sellerDecision.counterOffer) {
        currentPrice = sellerDecision.counterOffer;
      }

      // Final round - force agreement and add explicit acceptance to history
      if (round === MAX_ROUNDS) {
        const midpoint = (buyerDecision.offer + currentPrice) / 2;
        agreedPrice = Math.max(minPrice, Math.min(buyerMaxBudget, midpoint));
        console.log(`   ⚖️  Final round - agreed at midpoint: ${agreedPrice.toFixed(2)} ENC`);

        // Add explicit agreement messages to negotiation history
        negotiationHistory.push({
          round,
          agent: 'buyer',
          offer: agreedPrice,
          message: `I accept ${agreedPrice.toFixed(2)} ENC. Let's move forward with this agreement.`,
          tactic: 'Final Agreement',
          reasoning: 'Reached final agreement on mutually acceptable price',
          currentPrice: agreedPrice
        });

        negotiationHistory.push({
          round,
          agent: 'seller',
          offer: agreedPrice,
          message: `Agreed! ${agreedPrice.toFixed(2)} ENC is acceptable. I'll proceed with your order at this price.`,
          tactic: 'Final Agreement',
          reasoning: 'Accepted final price - ready to deliver service',
          buyerOffer: agreedPrice
        });
      }
    }

    // Ensure we have an agreed price
    if (!agreedPrice) {
      agreedPrice = Math.max(minPrice, Math.min(buyerMaxBudget, (minPrice + currentPrice) / 2));
    }

    agreedPrice = parseFloat(agreedPrice.toFixed(2));

    console.log(`\n✅ Negotiation complete! Final price: ${agreedPrice} ENC`);

    addSellerActivity({
      type: 'negotiation_complete',
      title: `🤝 Negotiation Successful - ${seller.name}`,
      content: `Final agreed price: ${agreedPrice} ENC (Original: ${seller.price} ENC)`,
      artist: seller.name,
      status: 'completed',
      finalPrice: agreedPrice,
      originalPrice: seller.price,
      negotiationHistory: negotiationHistory
    });

    res.json({
      success: true,
      agreedPrice,
      originalPrice: seller.price,
      savings: (parseFloat(seller.price) - agreedPrice).toFixed(2),
      negotiationHistory,
      seller,
      sellerName: seller.name
    });

  } catch (err) {
    console.error('Error in negotiation:', err);
    res.status(500).json({ error: err.message });
  }
});

// Execute purchase
app.post('/api/purchase', async (req, res) => {
  try {
    const { imageBase64, seller, requirements } = req.body;

    // Use agreed price from negotiation, or default price
    const finalPrice = seller.agreedPrice || seller.price;
    console.log(`\n🎨 Processing purchase from ${seller.name}... (Price: ${finalPrice} ENC)`);

    // Track balance before transaction
    balanceTracking.before = await getSellerBalance();

    addSellerActivity({
      type: 'order_received',
      title: `📥 Order received for ${seller.name}`,
      content: `Processing ${seller.style} style portrait`,
      artist: seller.name,
      status: 'working',
      inputImage: `data:image/jpeg;base64,${imageBase64}`
    });

    // Step 1: Request portrait (expecting 402)
    console.log(`   Step 1: Requesting portrait from ${seller.endpoint}`);
    let response = await fetch(`${seller.endpoint}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: imageBase64,
        style: seller.style,
        description: "Create a professional portrait suitable for printing and framing",
        buyerAddress: buyerWallet.address,
        negotiatedPrice: finalPrice  // Pass negotiated price from MCP negotiation
      })
    });

    let data = await response.json();

    // Step 2: Handle 402 Payment Required
    if (response.status === 402) {
      console.log('   Step 2: Received HTTP 402 Payment Required');
      const invoice = data;

      addSellerActivity({
        type: 'invoice_created',
        title: `📄 Invoice created by ${seller.name}`,
        content: `Invoice ID: ${invoice.invoiceId}`,
        invoice: {
          id: invoice.invoiceId,
          amount: invoice.amount,
          artist: seller.name
        },
        artist: seller.name,
        status: 'working'
      });

      // Step 3: Pay invoice
      console.log('   Step 3: Processing payment...');
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
        [
          "function payInvoice(bytes32 invoiceId) external",
          "function withdraw(bytes32 invoiceId) external"
        ],
        buyerWallet
      );

      const amount = ethers.parseUnits(invoice.amount.toString(), 18);
      const idBytes = ethers.encodeBytes32String(invoice.invoiceId);

      console.log('   - Approving token transfer...');
      const approveTx = await token.approve(invoice.registry, amount);
      await approveTx.wait();
      console.log(`   ✅ Approved: ${approveTx.hash}`);

      console.log('   - Paying invoice...');
      const payTx = await registry.payInvoice(idBytes);
      await payTx.wait();
      console.log(`   ✅ Payment confirmed: ${payTx.hash}`);

      // Auto-withdraw funds to seller wallet
      console.log('   - Auto-withdrawing to seller wallet...');
      const sellerRegistry = new ethers.Contract(
        invoice.registry,
        ["function withdraw(bytes32 invoiceId) external"],
        sellerWallet
      );
      try {
        const withdrawTx = await sellerRegistry.withdraw(idBytes);
        await withdrawTx.wait();
        console.log(`   ✅ Auto-withdrawal successful: ${withdrawTx.hash}`);
      } catch (withdrawErr) {
        console.log(`   ⚠️ Auto-withdrawal failed (non-critical): ${withdrawErr.message}`);
      }

      // Track balance after payment
      balanceTracking.after = await getSellerBalance();

      const balanceAfterPayment = await getSellerBalance();

      addSellerActivity({
        type: 'payment_received',
        title: `💰 Payment received - ${seller.name}`,
        content: `Received ${invoice.amount} ENC payment. Generating artwork...`,
        invoice: {
          id: invoice.invoiceId,
          amount: invoice.amount,
          artist: seller.name
        },
        txHash: payTx.hash,
        artist: seller.name,
        status: 'working',
        balanceBefore: balanceTracking.before,
        balanceAfter: balanceAfterPayment,
        balanceChange: `+${invoice.amount}`
      });

      // Step 4: Retry request with invoice ID
      console.log('   Step 4: Retrying request after payment...');
      response = await fetch(`${seller.endpoint}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: imageBase64,
          style: seller.style,
          description: "Create a professional portrait suitable for printing and framing",
          invoiceId: invoice.invoiceId,
          buyerAddress: buyerWallet.address
        })
      });

      data = await response.json();

      // Build activity content with NFT info if available
      let activityContent = `${seller.style} style portrait completed and delivered to buyer`;
      if (data.nft) {
        activityContent += ` | NFT minted: Token #${data.nft.tokenId}`;
      }

      addSellerActivity({
        type: 'artwork_delivered',
        title: `✅ Artwork delivered by ${seller.name}`,
        content: activityContent,
        artist: seller.name,
        status: 'completed',
        generatedArtwork: data.portraitUrl,
        nft: data.nft || null
      });

      // Return success with NFT details
      const responseData = {
        success: true,
        portraitUrl: data.portraitUrl,
        txHash: payTx.hash,
        amount: invoice.amount,
        seller: seller.name,
        style: seller.style
      };

      // Include NFT details if available
      if (data.nft) {
        responseData.nft = data.nft;
      }

      res.json(responseData);

    } else {
      res.status(400).json({ error: 'Expected HTTP 402 but got: ' + response.status });
    }

  } catch (err) {
    console.error('Error processing purchase:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get seller activity
app.get('/api/seller-activity', (req, res) => {
  res.json(sellerActivity);
});

// Clear seller activity (for demo purposes)
app.post('/api/clear-seller-activity', (req, res) => {
  sellerActivity = [];
  balanceTracking = {
    before: null,
    after: null
  };
  console.log('🧹 Seller activity cleared for demo');
  res.json({ ok: true, message: 'Seller activity cleared' });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 TrufflePay API Server running on http://localhost:${PORT}`);
  console.log(`   Buyer UI: http://localhost:${PORT}/`);
  console.log(`   Seller Dashboard: http://localhost:${PORT}/seller`);
  console.log(`\n   Buyer Wallet: ${buyerWallet.address}`);
  console.log(`   Seller Wallet: ${sellerWallet.address}`);
  console.log(`   Token: ${TOKEN_ADDRESS}\n`);
});
