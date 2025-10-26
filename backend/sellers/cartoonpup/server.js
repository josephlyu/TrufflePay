// backend/sellers/cartoonpup/server.js
// CartoonPup: Professional Cartoon/Anime Style AI Pet Portrait Artist
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
const PORT = 3032;
const SELLER_ID = 'cartoonpup';
const STYLE = 'cartoon anime';
const PRICE = '5'; // 5 ENC tokens (high quality)

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RPC_URL = process.env.RPC_URL;
const SELLER_PRIVATE_KEY = process.env.SELLER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
const PAYMENT_REGISTRY_ADDRESS = process.env.PAYMENT_REGISTRY_ADDRESS;

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

// ===== Serve Static Assets =====
// This allows buyers to download generated portraits via HTTP
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
// Must be <= 31 characters for bytes32 encoding
function generateInvoiceId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 5);
  return `cp-${timestamp}-${random}`; // cp = cartoonpup
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
// Converts base64 image data from buyer into a local file
function saveBase64Image(base64Data, outputPath) {
  const buffer = Buffer.from(base64Data, 'base64');
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

// ===== Download Image from URL =====
// Downloads generated image from OpenAI to local storage
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

// ===== STEP 1: Analyze Dog Photo with GPT-4 Vision =====
// This extracts detailed visual features from the input photo
async function analyzeDogPhoto(imagePath) {
  try {
    console.log(`   🔍 Analyzing dog photo with GPT-4 Vision...`);

    // Read the image and encode to base64 for OpenAI
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');

    // Call GPT-4 Vision to analyze the dog
    const response = await openai.chat.completions.create({
      model: "gpt-4o", // Latest vision model
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "You are a professional cartoon/anime pet portrait artist. Analyze this dog photo for creating a recognizable cartoon/anime illustration.\n\nDescribe in detail:\n- POSE AND ORIENTATION: How is the dog positioned? (frontal view, side profile, sitting, etc.) - this must be preserved\n- Breed characteristics (specific breed features that make it recognizable)\n- Coat color and pattern (be specific - this dog's unique coloring must be accurate)\n- Facial features: eye color and expression, nose, mouth\n- Ear shape, size, and how they hang/stand\n- Distinctive markings or features that identify this specific dog\n- Overall composition\n\nBe extremely specific so the cartoon portrait is clearly recognizable as THIS dog, just drawn in anime/cartoon style."
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`,
                detail: "high" // Request high-detail analysis
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
    // Fallback description if Vision API fails
    return "a cute dog with big expressive eyes and adorable features";
  }
}

// ===== STEP 2: Generate Cartoon Portrait with DALL-E 3 =====
// Uses the detailed description to create a cartoon/anime styled portrait
async function generateCartoonPortrait(dogDescription) {
  try {
    console.log(`   🎨 Generating cartoon/anime portrait with DALL-E 3...`);

    // Craft a recognizable cartoon/anime prompt
    const prompt = `Create a cute, professional cartoon/anime style FACE PORTRAIT of this dog: ${dogDescription}

CRITICAL REQUIREMENTS:
- FACE PORTRAIT ONLY - focus on the head and face, do NOT include the body or full figure
- MATCH THE FACIAL ORIENTATION from the description (frontal face, side profile face, three-quarter face angle, etc.)
- Frame the composition to show primarily the face, head, and upper neck area

Style: Modern cartoon/anime illustration with:
- RECOGNIZABLE as this specific dog's face - keep facial features, coloring, and markings accurate
- Cute anime/cartoon art style with BIG expressive eyes and charming character design
- Smooth clean lines and professional digital illustration quality
- Vibrant, appealing colors that match the dog's actual facial coloring
- Kawaii aesthetic but not overly exaggerated - balance cuteness with recognizability
- Professional character design suitable for digital prints and merchandise
- Fun, energetic personality while maintaining accurate facial features

The result should be an adorable cartoon/anime FACE PORTRAIT where viewers immediately recognize it as THIS specific dog's face, just drawn in cute anime style. Think professional pet cartoon artist - accurate facial subject with appealing anime/cartoon stylization. CLOSE-UP FACE COMPOSITION ONLY.`;

    console.log(`   📝 Prompt: ${prompt.substring(0, 150)}...`);

    const response = await openai.images.generate({
      model: "dall-e-3",
      prompt: prompt,
      n: 1,
      size: "1024x1024",
      quality: "standard", // Use "hd" for even higher quality
      style: "vivid" // "vivid" creates more vibrant, artistic images
    });

    const imageUrl = response.data[0].url;
    console.log(`   ✅ Portrait generated successfully`);
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
    name: 'CartoonPup',
    style: STYLE,
    price: PRICE,
    token: TOKEN_ADDRESS,
    registry: PAYMENT_REGISTRY_ADDRESS,
    description: 'Cute cartoon/anime pet portraits using AI',
    features: ['Image-to-image generation', 'GPT-4 Vision analysis', 'Vibrant kawaii style']
  });
});

// POST /generate - Generate pet portrait (x402 flow with image input)
app.post('/generate', async (req, res) => {
  try {
    const { imageBase64, style: requestedStyle, description, invoiceId: existingInvoiceId, negotiatedPrice } = req.body;

    console.log(`\n📥 Received portrait request`);

    // Use negotiated price from MCP negotiation, or default PRICE
    const finalPrice = negotiatedPrice || PRICE;
    console.log(`   Price: ${finalPrice} ENC ${negotiatedPrice ? '(negotiated via MCP)' : '(default)'}`);

    // Validate that buyer sent image data
    if (!imageBase64) {
      return res.status(400).json({
        error: 'Missing image data',
        message: 'Please provide imageBase64 in request body'
      });
    }

    // Generate unique invoice ID for this request (or use existing)
    const invoiceId = existingInvoiceId || generateInvoiceId();

    console.log(`   Invoice ID: ${invoiceId}`);
    console.log(`   Style: ${requestedStyle || STYLE}`);
    console.log(`   Image data: ${imageBase64.length} characters`);

    // Check payment status on-chain
    const paid = await isInvoicePaid(invoiceId);

    if (!paid) {
      // ===== PAYMENT REQUIRED (HTTP 402) =====
      console.log(`💳 Payment required for invoice: ${invoiceId}`);

      // Check if this is a new invoice that needs to be registered on-chain
      const invoices = loadInvoices();
      if (!invoices[invoiceId]) {
        // Register invoice on-chain first
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

        // Save invoice locally
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
        message: `Payment required. Pay ${finalPrice} ENC to receive your cartoon pet portrait.`,
        service: 'CartoonPup - Cute Cartoon/Anime Pet Portraits'
      });
    }

    // ===== PAYMENT CONFIRMED - GENERATE PORTRAIT =====
    console.log(`✅ Payment confirmed for invoice: ${invoiceId}`);

    // Update local store
    const invoices = loadInvoices();
    if (invoices[invoiceId]) {
      invoices[invoiceId].paid = true;
      invoices[invoiceId].paidAt = Date.now();
      saveInvoices(invoices);
    }

    // Save the input image temporarily
    const inputImagePath = path.join(TMP_DIR, `input_${invoiceId}.jpg`);
    saveBase64Image(imageBase64, inputImagePath);
    console.log(`   💾 Saved input image: ${inputImagePath}`);

    // STEP 1: Analyze the dog photo with GPT-4 Vision
    const dogDescription = await analyzeDogPhoto(inputImagePath);

    // STEP 2: Generate cartoon portrait with DALL-E 3
    const generatedUrl = await generateCartoonPortrait(dogDescription);

    // STEP 3: Download and save the generated portrait locally
    const outputImagePath = path.join(ASSETS_DIR, `portrait_${invoiceId}.png`);
    await downloadImage(generatedUrl, outputImagePath);
    console.log(`   💾 Saved portrait: ${outputImagePath}`);

    // STEP 4: Return success with local URL for buyer to download
    const publicUrl = `http://localhost:${PORT}/assets/portrait_${invoiceId}.png`;

    return res.status(200).json({
      ok: true,
      paid: true,
      invoiceId: invoiceId,
      portraitUrl: publicUrl,
      style: STYLE,
      seller: 'CartoonPup',
      message: 'Your adorable cartoon pet portrait is ready!',
      quality: 'Print-ready, vibrant anime/cartoon art',
      ap2Receipt: {
        invoiceId: invoiceId,
        amount: PRICE,
        token: TOKEN_ADDRESS,
        paidAt: Date.now()
      }
    });

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
  console.log(`\n🎨 CartoonPup (Cartoon/Anime Artist) running on port ${PORT}`);
  console.log(`   Seller Address: ${wallet.address}`);
  console.log(`   Style: ${STYLE} (kawaii, vibrant, expressive)`);
  console.log(`   Price: ${PRICE} ENC`);
  console.log(`   Features: GPT-4 Vision + DALL-E 3`);
  console.log(`   Quality: Print-ready, digital illustration\n`);
});
