// Direct GPT-4 Vision API Call Example
// Shows how to analyze an image with GPT-4 Vision and see full output
require('dotenv').config();
const OpenAI = require('openai');
const fs = require('fs');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function testVisionAPI() {
  console.log('🔍 Testing GPT-4 Vision API with your dog photo...\n');

  // Step 1: Read and encode image to base64
  const imagePath = './assets/truffle.jpg';
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');

  console.log(`📷 Image loaded: ${imagePath}`);
  console.log(`   Size: ${(imageBuffer.length / 1024).toFixed(2)} KB\n`);

  // Step 2: Call GPT-4 Vision API
  console.log('🤖 Calling GPT-4 Vision API...\n');

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "You are a contemporary art curator analyzing subjects for modern art portraits. Analyze this dog photo in exceptional detail for creating a museum-quality contemporary art piece. Describe: breed characteristics, physical form and proportions, color palette (be specific about hues and tones), distinctive features, spatial composition, visual rhythm, and artistic potential. Focus on elements that translate well to abstract, minimalist, or contemporary art styles."
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${base64Image}`,
              detail: "high" // Can be "low", "high", or "auto"
            }
          }
        ]
      }
    ],
    max_tokens: 500
  });

  // Step 3: Display full analysis
  const analysis = response.choices[0].message.content;

  console.log('═'.repeat(80));
  console.log('GPT-4 VISION ANALYSIS OUTPUT:');
  console.log('═'.repeat(80));
  console.log(analysis);
  console.log('═'.repeat(80));

  console.log(`\n📊 API Usage:`);
  console.log(`   Model: ${response.model}`);
  console.log(`   Prompt tokens: ${response.usage.prompt_tokens}`);
  console.log(`   Completion tokens: ${response.usage.completion_tokens}`);
  console.log(`   Total tokens: ${response.usage.total_tokens}`);

  return analysis;
}

// Run the test
testVisionAPI().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
