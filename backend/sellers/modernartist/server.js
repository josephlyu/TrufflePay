// backend/sellers/modernartist/server.js
// ModernArtist: Premium Modern/Contemporary Art Style AI Pet Portrait Artist
// Uses GPT-4 Vision to analyze input photo + DALL-E 3 for generation
require('dotenv').config();
const express = require('express');
const { ethers } = require('ethers');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
app.use(express.json({ limit: '10mb' })); // Increase limit for base64 images

// ===== Configuration =====
const PORT = 3033;
const SELLER_ID = 'modernartist';
const STYLE = 'modern contemporary';
const PRICE = '10'; // 10 ENC tokens (premium pricing with NFT)

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RPC_URL = process.env.RPC_URL;
const SELLER_PRIVATE_KEY = process.env.SELLER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
const NFT_OWNER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY; // NFT contract owner
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
const PAYMENT_REGISTRY_ADDRESS = process.env.PAYMENT_REGISTRY_ADDRESS;
const NFT_CONTRACT_ADDRESS = process.env.NFT_CONTRACT_ADDRESS;

// Directories for file storage
const TMP_DIR = path.join(__dirname, 'tmp');
const ASSETS_DIR = path.join(__dirname, 'assets');

// Ensure directories exist
[TMP_DIR, ASSETS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Validate environment variables
if (!OPENAI_API_KEY) {
  console.error('❌ Missing OPENAI_API_KEY in .env');
  process.exit(1);
}
if (!RPC_URL || !PAYMENT_REGISTRY_ADDRESS || !TOKEN_ADDRESS) {
  console.error('❌ Missing blockchain config in .env');
  process.exit(1);
}

// ===== Initialize OpenAI =====
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ===== Initialize Blockchain =====
const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(SELLER_PRIVATE_KEY, provider);

const REGISTRY_ABI = [
  "function invoices(bytes32) view returns (address seller, address token, uint256 amount, bool paid)",
  "function createInvoice(bytes32 invoiceId, address token, uint256 amount) external"
];
const registry = new ethers.Contract(PAYMENT_REGISTRY_ADDRESS, REGISTRY_ABI, wallet);

const NFT_ABI = [
  "function mintPortrait(address buyer, string memory artist, string memory style, string memory metadataURI) public returns (uint256)",
  "event PortraitMinted(uint256 indexed tokenId, address indexed buyer, string artist, string style, string tokenURI)"
];
let nftContract = null;
if (NFT_CONTRACT_ADDRESS && NFT_OWNER_PRIVATE_KEY) {
  const nftWallet = new ethers.Wallet(NFT_OWNER_PRIVATE_KEY, provider);
  nftContract = new ethers.Contract(NFT_CONTRACT_ADDRESS, NFT_ABI, nftWallet);
  console.log(`   NFT Minting Enabled - Owner: ${nftWallet.address}`);
}

// ===== Serve Static Assets =====
app.use('/assets', express.static(ASSETS_DIR));

// ===== Local Invoice Store =====
const INVOICE_STORE_PATH = path.join(__dirname, 'invoiceStore.json');
if (!fs.existsSync(INVOICE_STORE_PATH)) {
  fs.writeFileSync(INVOICE_STORE_PATH, JSON.stringify({}));
}

function loadInvoices() {
  try {
    return JSON.parse(fs.readFileSync(INVOICE_STORE_PATH, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveInvoices(data) {
  fs.writeFileSync(INVOICE_STORE_PATH, JSON.stringify(data, null, 2));
}

// ===== Generate unique invoice ID =====
function generateInvoiceId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 5);
  return `ma-${timestamp}-${random}`; // ma = modernartist
}

// ===== Check if invoice is paid on-chain =====
async function isInvoicePaid(invoiceId) {
  try {
    const idBytes = ethers.encodeBytes32String(invoiceId);
    const invoice = await registry.invoices(idBytes);
    return invoice.paid === true || invoice[3] === true;
  } catch (err) {
    console.error('Error checking payment:', err.message);
    return false;
  }
}

// ===== Save Base64 Image to File =====
function saveBase64Image(base64Data, outputPath) {
  const buffer = Buffer.from(base64Data, 'base64');
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

// ===== Download Image from URL =====
async function downloadImage(url, outputPath) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }

      const file = fs.createWriteStream(outputPath);
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(outputPath);
      });
    }).on('error', reject);
  });
}

// ===== Mint NFT for Buyer =====
async function mintNFT(buyerAddress, artworkUrl) {
  if (!nftContract) {
    console.log(`   ⚠️ NFT contract not configured, skipping NFT minting`);
    return null;
  }

  try {
    console.log(`   🎨 Minting NFT for buyer: ${buyerAddress}`);

    // Create metadata URI (using the artwork URL as the metadata)
    const metadataURI = artworkUrl;

    const tx = await nftContract.mintPortrait(
      buyerAddress,
      'ModernArtist',
      STYLE,
      metadataURI
    );

    console.log(`   ⏳ Waiting for NFT mint transaction: ${tx.hash}`);
    const receipt = await tx.wait();

    // Extract tokenId from the PortraitMinted event
    const mintEvent = receipt.logs.find(log => {
      try {
        const parsed = nftContract.interface.parseLog(log);
        return parsed && parsed.name === 'PortraitMinted';
      } catch {
        return false;
      }
    });

    let tokenId = null;
    if (mintEvent) {
      const parsed = nftContract.interface.parseLog(mintEvent);
      tokenId = parsed.args.tokenId.toString();
    }

    console.log(`   ✅ NFT minted successfully! Token ID: ${tokenId}`);

    return {
      tokenId,
      contractAddress: NFT_CONTRACT_ADDRESS,
      transactionHash: tx.hash,
      arbiscanUrl: `https://sepolia.arbiscan.io/token/${NFT_CONTRACT_ADDRESS}?a=${tokenId}`
    };

  } catch (err) {
    console.error(`   ❌ NFT minting failed: ${err.message}`);
    return null;
  }
}

// ===== STEP 1: Analyze Dog Photo with GPT-4 Vision =====
async function analyzeDogPhoto(imagePath) {
  try {
    console.log(`   🔍 Analyzing dog photo with GPT-4 Vision...`);

    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "You are a contemporary portrait artist analyzing a dog photo for a modern, realistic artistic interpretation. The final artwork must accurately match the input photo.\n\nAnalyze this dog photo in exceptional detail:\n- POSE AND ORIENTATION: Describe exactly how the dog is positioned (frontal view, side profile, three-quarter view, sitting, standing, etc.) - this MUST be preserved in the artwork\n- Breed characteristics: specific breed features, face shape, ear style and position\n- Facial features: eye color and expression, nose, mouth, distinctive markings\n- Color palette: exact fur colors with specific hues (deep black, chocolate brown, tan, white markings, etc.)\n- Fur texture and length, especially around ears, face, and body\n- Background and lighting in the original photo\n- Overall mood and personality\n\nBe extremely specific about the pose and orientation so the generated artwork matches the input photo's composition and perspective."
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`,
                detail: "high"
              }
            }
          ]
        }
      ],
      max_tokens: 400
    });

    const description = response.choices[0].message.content;
    console.log(`   ✅ Analysis complete: ${description.substring(0, 100)}...`);
    return description;

  } catch (err) {
    console.error(`   ❌ Vision analysis failed: ${err.message}`);
    return "a sophisticated dog subject with strong visual presence and artistic character";
  }
}

// ===== STEP 2: Generate Modern/Contemporary Portrait with DALL-E 3 =====
async function generateModernPortrait(dogDescription) {
  try {
    console.log(`   🎨 Generating modern/contemporary portrait with DALL-E 3 HD...`);

    // Craft a realistic portrait with dreamy, ethereal quality
    const prompt = `Create a beautiful, realistic modern art FACE PORTRAIT of this dog: ${dogDescription}

CRITICAL REQUIREMENTS:
- FACE PORTRAIT ONLY - focus on the head and face, do NOT include the body or full figure
- MATCH THE FACIAL ORIENTATION from the description (frontal face view, side profile face, three-quarter face angle, etc.)
- Keep the dog's specific facial features, markings, and coloring accurate to the description
- Maintain realistic facial proportions and anatomy - this should look like a real dog face portrait
- Frame the composition to show primarily the face, head, and upper neck area

Style Guidelines:
- Realistic contemporary portrait painting style with DREAMY, ETHEREAL quality
- Add soft, gentle lighting with a luminous glow around the face
- Use subtle soft focus and bokeh effects in the background for dreamlike atmosphere
- Rich, accurate colors with sophisticated palette and depth, but with a magical, enchanted quality
- Incorporate gentle light particles or subtle atmospheric haze for an ethereal feel
- Professional lighting that creates a soft, romantic mood - think magical realism
- Expressive brushwork that adds artistic quality without distorting the facial features
- Background should be softly blurred with dreamy, out-of-focus elements
- Add a sense of wonder and beauty - like a fairy tale face portrait with realistic subject
- Gallery-quality finish suitable for framing and display

The result should be a premium, realistic dog FACE PORTRAIT with modern artistic quality AND a dreamy, enchanted atmosphere - viewers should immediately recognize the specific dog's face while feeling like they're looking at something magical and special. Think high-end pet face photography meets fantasy art lighting. CLOSE-UP FACE COMPOSITION ONLY.`;

    console.log(`   📝 Prompt: ${prompt.substring(0, 150)}...`);

    const response = await openai.images.generate({
      model: "dall-e-3",
      prompt: prompt,
      n: 1,
      size: "1024x1024",
      quality: "hd", // Premium HD quality for 2 ENC price point
      style: "natural" // Natural for more sophisticated, less cartoonish
    });

    const imageUrl = response.data[0].url;
    console.log(`   ✅ Premium portrait generated successfully`);
    return imageUrl;

  } catch (err) {
    console.error(`   ❌ DALL-E generation failed: ${err.message}`);
    throw new Error('Failed to generate portrait');
  }
}

// ===== ENDPOINTS =====

// GET /quote - Return seller metadata and pricing
app.get('/quote', (req, res) => {
  res.json({
    seller: SELLER_ID,
    name: 'ModernArtist',
    style: STYLE,
    price: PRICE,
    token: TOKEN_ADDRESS,
    registry: PAYMENT_REGISTRY_ADDRESS,
    description: 'Premium modern and contemporary art portraits - museum-quality with NFT certificate',
    features: ['HD quality generation', 'GPT-4 Vision analysis', 'Contemporary art style', 'Gallery-worthy', 'NFT certificate included']
  });
});

// POST /generate - Generate pet portrait (x402 flow with image input)
app.post('/generate', async (req, res) => {
  try {
    const { imageBase64, style: requestedStyle, description, invoiceId: existingInvoiceId, buyerAddress, negotiatedPrice } = req.body;

    console.log(`\n📥 Received portrait request`);
    if (buyerAddress) {
      console.log(`   Buyer Address: ${buyerAddress} (for NFT minting)`);
    }

    // Use negotiated price from MCP negotiation, or default PRICE
    const finalPrice = negotiatedPrice || PRICE;
    console.log(`   Price: ${finalPrice} ENC ${negotiatedPrice ? '(negotiated via MCP)' : '(default)'}`);

    if (!imageBase64) {
      return res.status(400).json({
        error: 'Missing image data',
        message: 'Please provide imageBase64 in request body'
      });
    }

    const invoiceId = existingInvoiceId || generateInvoiceId();

    console.log(`   Invoice ID: ${invoiceId}`);
    console.log(`   Style: ${requestedStyle || STYLE}`);
    console.log(`   Image data: ${imageBase64.length} characters`);

    const paid = await isInvoicePaid(invoiceId);

    if (!paid) {
      // ===== PAYMENT REQUIRED (HTTP 402) =====
      console.log(`💳 Payment required for invoice: ${invoiceId}`);

      const invoices = loadInvoices();
      if (!invoices[invoiceId]) {
        try {
          console.log(`   📝 Registering invoice on-chain...`);
          const idBytes = ethers.encodeBytes32String(invoiceId);
          const amount = ethers.parseUnits(finalPrice.toString(), 18);
          const tx = await registry.createInvoice(idBytes, TOKEN_ADDRESS, amount);
          await tx.wait();
          console.log(`   ✅ Registered on-chain: ${tx.hash}`);
        } catch (err) {
          console.error(`   ⚠️ Registration failed: ${err.message}`);
        }

        invoices[invoiceId] = {
          invoiceId,
          amount: finalPrice,
          token: TOKEN_ADDRESS,
          registry: PAYMENT_REGISTRY_ADDRESS,
          seller: wallet.address,
          style: requestedStyle || STYLE,
          createdAt: Date.now(),
          paid: false
        };
        saveInvoices(invoices);
      }

      return res.status(402).json({
        invoiceId: invoiceId,
        amount: finalPrice,
        token: TOKEN_ADDRESS,
        registry: PAYMENT_REGISTRY_ADDRESS,
        seller: wallet.address,
        message: `Payment required. Pay ${finalPrice} ENC for premium modern/contemporary art portrait.`,
        service: 'ModernArtist - Premium Contemporary Pet Portraits',
        quality: 'HD quality, museum-worthy, gallery-grade'
      });
    }

    // ===== PAYMENT CONFIRMED - GENERATE PORTRAIT =====
    console.log(`✅ Payment confirmed for invoice: ${invoiceId}`);

    const invoices = loadInvoices();
    if (invoices[invoiceId]) {
      invoices[invoiceId].paid = true;
      invoices[invoiceId].paidAt = Date.now();
      saveInvoices(invoices);
    }

    const inputImagePath = path.join(TMP_DIR, `input_${invoiceId}.jpg`);
    saveBase64Image(imageBase64, inputImagePath);
    console.log(`   💾 Saved input image: ${inputImagePath}`);

    // STEP 1: Analyze with GPT-4 Vision
    const dogDescription = await analyzeDogPhoto(inputImagePath);

    // STEP 2: Generate modern/contemporary portrait with DALL-E 3 HD
    const generatedUrl = await generateModernPortrait(dogDescription);

    // STEP 3: Download and save
    const outputImagePath = path.join(ASSETS_DIR, `portrait_${invoiceId}.png`);
    await downloadImage(generatedUrl, outputImagePath);
    console.log(`   💾 Saved portrait: ${outputImagePath}`);

    // STEP 4: Mint NFT if buyer address provided
    const publicUrl = `http://localhost:${PORT}/assets/portrait_${invoiceId}.png`;
    let nftDetails = null;

    if (buyerAddress && nftContract) {
      nftDetails = await mintNFT(buyerAddress, publicUrl);
    }

    // STEP 5: Return success with NFT details
    const response = {
      ok: true,
      paid: true,
      invoiceId: invoiceId,
      portraitUrl: publicUrl,
      style: STYLE,
      seller: 'ModernArtist',
      message: 'Your premium modern/contemporary art portrait is ready!',
      quality: 'HD quality, museum-worthy, gallery-grade contemporary art',
      ap2Receipt: {
        invoiceId: invoiceId,
        amount: PRICE,
        token: TOKEN_ADDRESS,
        paidAt: Date.now()
      }
    };

    // Add NFT details if minting was successful
    if (nftDetails) {
      response.nft = nftDetails;
      response.message = 'Your premium modern/contemporary art portrait is ready with NFT!';
    }

    return res.status(200).json(response);

  } catch (err) {
    console.error('❌ Error:', err.message);
    return res.status(500).json({
      error: 'Portrait generation failed',
      message: err.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🎨 ModernArtist (Contemporary Art Specialist) running on port ${PORT}`);
  console.log(`   Seller Address: ${wallet.address}`);
  console.log(`   Style: ${STYLE} (bold, sophisticated, avant-garde)`);
  console.log(`   Price: ${PRICE} ENC (premium)`);
  console.log(`   Features: GPT-4 Vision + DALL-E 3 HD`);
  console.log(`   Quality: Museum-worthy, gallery-grade\n`);
});
