// Test the new abstract vision prompt
require('dotenv').config();
const OpenAI = require('openai');
const fs = require('fs');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function testAbstractVision() {
  console.log('🎨 Testing Abstract GPT-4 Vision Analysis...\n');

  const imagePath = './assets/truffle.jpg';
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{
      role: "user",
      content: [
        {
          type: "text",
          text: "You are a modern art curator analyzing a dog portrait for an avant-garde, museum-quality abstraction inspired by early 20th-century masters such as Picasso, Kandinsky, and Zao Wou-Ki. Analyze the visual subject not as an animal, but as a composition of forms, colors, and rhythms.\n\nDescribe in exceptional detail:\n- Geometric and structural potential of the subject (planes, lines, negative space)\n- Dominant color blocks and their emotional resonance (specific hues, e.g. burnt sienna, prussian blue, titanium white)\n- Dynamic balance, asymmetry, and rhythm that could inspire Cubist or Abstract Expressionist reinterpretation\n- Emotional tone (joyful, introspective, enigmatic, etc.)\n- Opportunities for minimalist or deconstructive reinterpretation\n\nFocus on translating the subject into a contemporary fine-art abstraction suitable for exhibition."
        },
        {
          type: "image_url",
          image_url: {
            url: `data:image/jpeg;base64,${base64Image}`,
            detail: "high"
          }
        }
      ]
    }],
    max_tokens: 500
  });

  const analysis = response.choices[0].message.content;

  console.log('═'.repeat(80));
  console.log('ABSTRACT GPT-4 VISION ANALYSIS:');
  console.log('═'.repeat(80));
  console.log(analysis);
  console.log('═'.repeat(80));

  return analysis;
}

testAbstractVision().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
