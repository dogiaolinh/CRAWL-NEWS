// src/utils/apiCaller.js
const axios = require("axios");
require("dotenv").config();

// === CẤU HÌNH CÁC PROVIDER ===
const PROVIDERS = [
  // {
  //   name: "Gemini",
  //   keys: process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(",").map(k => k.trim()) : [],
  //   urlBuilder: (key) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
  //   format: "gemini",
  //   model: "gemini-2.5-flash",
  // },
  {
    name: "Groq",
    keys: process.env.GROQ_API_KEYS ? process.env.GROQ_API_KEYS.split(",").map(k => k.trim()) : [],
    url: "https://api.groq.com/openai/v1/chat/completions",
    format: "openai",
    model: "llama-3.3-70b-versatile", // model mạnh paraphrase trên Groq
  },
  {
    name: "Mistral",
    keys: process.env.MISTRAL_API_KEYS ? process.env.MISTRAL_API_KEYS.split(",").map(k => k.trim()) : [],
    url: "https://api.mistral.ai/v1/chat/completions",
    format: "openai",
    model: "mistral-large-latest",
  },
  // {
  //   name: "OpenRouter",
  //   keys: process.env.OPENROUTER_API_KEYS ? process.env.OPENROUTER_API_KEYS.split(",").map(k => k.trim()) : [],
  //   url: "https://openrouter.ai/api/v1/chat/completions",
  //   format: "openai",
  //   model: "liquid/lfm-2.5-1.2b-thinking:free", // hoặc model free tốt khác
  // },
];

// === PROMPT CHUNG (giữ nguyên prompt chất lượng cao của anh) ===
const createPrompt = (text) => `
You are a senior English news editor at TodayNews, an independent international news outlet.

**Strict Rules (must follow exactly):**
- Preserve 100% of all facts: names, dates, numbers, quotes (keep in ""), locations, events, and sources.
- Maintain the original HTML structure exactly: keep all <p>, <img>, <figure>, <em>, <strong>, <ul>, <li>, etc. in the same order and nesting. Do not add, remove, or modify any tags or attributes.
- NO AUTO-FIX: Do not fix, balance, or complete any HTML tags. Output exactly as-is if malformed.
- NO WRAPPING: Do not wrap output in <div>, <body>, <html>, code blocks, or any new tags.
- NO INDENTATION: Do not add extra spaces, tabs, or newlines that weren't in the original.
- IDENTICAL ENDING: End the output at the exact same character/tag as the input.
- FORBIDDEN: Do not insert any new <div> or any tag not present in the original.

**Task:**
Rewrite the article to make it original and copyright-safe:
- Significantly rephrase sentence structure, word choice, and paragraph flow.
- Avoid any 5+ word phrases from the original (except direct quotes).
- Remove all references to "CNN", "TodayNews", or any specific outlet branding (e.g., "(CNN)", "By [Name], CNN" → simply "By [Name]" or remove if not essential).
- Keep tone neutral, professional, and journalistic.
-Output only the rewritten HTML. Do not add any explanation.
**Mindset:** Create a fresh wire-style news dispatch from the raw facts — fact-for-fact identical but linguistically unique. It must pass plagiarism checks while remaining fully accurate.

Original HTML content:
${text}

Now rewrite following all rules above:
`;

async function paraphraseText(text) {
  if (!text?.trim()) return text;

  const delayBetweenRequests = 5000; // 5 giây giữa mỗi request để tránh rate limit toàn cục

  for (const provider of PROVIDERS) {
    if (provider.keys.length === 0) {
      console.warn(`Provider ${provider.name} không có key → bỏ qua`);
      continue;
    }

    // console.log(`\n=== Thử provider: ${provider.name} (${provider.keys.length} keys) ===`);

    let keyIndex = 0;
    let attempts = 0;
    const maxAttempts = 3 * provider.keys.length; // retry 3 lần mỗi key

    while (attempts < maxAttempts) {
      const apiKey = provider.keys[keyIndex];

      try {
        // console.log(`  Gọi ${provider.name} (key ${keyIndex + 1}/${provider.keys.length})...`);

        let response;
        const prompt = createPrompt(text);

        if (provider.format === "gemini") {
          // Gemini format đặc biệt
          response = await axios.post(provider.urlBuilder(apiKey), {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.8,
              maxOutputTokens: 8192,
              topP: 0.95,
            },
          }, { timeout: 180000 });
          const result = response.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (result) {
            console.log(`  Thành công với ${provider.name}`);
            return result;
          }
        } else {
          // OpenAI-compatible (Groq, Mistral, OpenRouter)
          response = await axios.post(provider.url, {
            model: provider.model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.8,
            max_tokens: 8192,
            top_p: 0.95,
          }, {
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`,
            },
            timeout: 180000,
          });
          const result = response.data.choices?.[0]?.message?.content?.trim();
          if (result && result.length > 100) {
            // console.log(`  Thành công với ${provider.name}`);
            // console.log(text);
            // console.log("-------------------------------------------------------------------------");

            // console.log(result);
            return result;
          }
        }

        throw new Error("Kết quả không hợp lệ");

      } catch (err) {
        const status = err.response?.status;
        // console.error(`  Lỗi ${provider.name} (key ${keyIndex + 1}): ${err.message} [${status || "unknown"}]`);

        // Xử lý lỗi
        if ([429, 503, 402].includes(status)) {
          // console.warn(`  Rate limit / hết balance → chờ ${delayBetweenRequests / 1000}s...`);
          await new Promise(r => setTimeout(r, delayBetweenRequests));
        } else if ([401, 403].includes(status)) {
          // console.error(`  Key invalid/blocked → bỏ key này`);
        }

        // Xoay key trong provider hiện tại
        keyIndex = (keyIndex + 1) % provider.keys.length;
        attempts++;

        // Nếu hết key của provider → chuyển provider tiếp theo
        if (attempts >= maxAttempts) {
          console.warn(`  Hết key của ${provider.name} → chuyển sang provider tiếp theo`);
          break;
        }
      }
    }
  }

  console.error("🚫 Tất cả provider và key đều lỗi → trả về text gốc");
  return text;
}

module.exports = { paraphraseText };