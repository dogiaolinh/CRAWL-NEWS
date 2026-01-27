// src/utils/apiCaller.js
const axios = require("axios");
require("dotenv").config();

// === CẤU HÌNH CÁC PROVIDER ===
const PROVIDERS = [
  {
    name: "Gemini",
    keys: process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(",").map(k => k.trim()) : [],
    urlBuilder: (key) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
    format: "gemini",
    model: "gemini-2.5-flash",
  },
  {
    name: "Groq",
    keys: process.env.GROQ_API_KEYS ? process.env.GROQ_API_KEYS.split(",").map(k => k.trim()) : [],
    url: "https://api.groq.com/openai/v1/chat/completions",
    format: "openai",
    model: "llama-3.1-8b-instant", // model mạnh paraphrase trên Groq
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
### 🧠 Strict Technical Constraints (Top Priority):
- **NO AUTO-FIX**: Do not attempt to fix, balance, or complete HTML tags. If a </div> exists without a opening <div>, leave it exactly like that.
- **NO WRAPPING**: Do not wrap the output in any new <div>, <body>, or <html> tags.
- **NO INDENTATION**: Do not add any new tabs or spaces at the beginning of lines that weren't there.
- **IDENTICAL ENDING**: The output must end at the exact same character/tag as the input. If the input ends with a word, do not add a newline or a tag.
- **FORBIDDEN TAGS**: Do not insert any <div> tags that are not present in the original text.

You are a **senior English news editor** working for TodayNews, an independent international news outlet.
Your task is to **rewrite the following article** to create an original version that:
- **Avoids any copyright infringement** by significantly rephrasing structure, sentence flow, and wording while preserving 100% of the factual content.
- **Remains fully factual, neutral, and professional** — suitable for publication on a reputable global news site.

🎯 **Core Requirements:**
- **Preserve 100% of facts**: names, dates, numbers, direct quotes (in quotation marks), locations, events, timelines, and sources must remain **exactly** as in the original.
- **Eliminate all references to "CNN", "TodayNews" branding in source attribution, or any previous outlet-specific marking**:
  - Remove "(CNN)", "CNN.com", "Reporting by CNN", "CNN Exclusive", etc.      
  - Replace reporter bylines like "By [Name], CNN" or "By [Name], TodayNews" → simply "By [Name]" or remove if not essential to the story.
  - Do not imply affiliation with CNN, TodayNews (in source context), or any other specific brand in a way that suggests the original source.
- **Rephrase aggressively for originality**:
  - Restructure paragraphs and lead.
  - Use synonyms, vary sentence length and rhythm.
  - Break or combine sentences to create a **distinct narrative flow**.
  - Avoid copying any 5+ word phrase verbatim unless it's a direct quote.
- **Maintain HTML structure** exactly: keep all <p>, <img>, <figure>, <em>, <strong>, <ul>, <li>, etc., in the same order and nesting.
- **Do NOT**:
  - Translate to another language.
  - Add, remove, or invent any information.
  - Use passive voice excessively.
  - Include watermarks, disclaimers, or meta-commentary.
  - Wrap output in code blocks or quotes.

🧠 **Mindset: Copyright-Safe Transformation**
Think like a skilled editor crafting an **original wire-style dispatch** from raw facts for TodayNews. 
The output must read as if written from scratch by our newsroom — **fact-for-fact identical**, but **linguistically unique**.
It should pass plagiarism checks while retaining full journalistic integrity.

🧠 Important Formatting Rules:
- Maintain the original HTML structure exactly.
- DO NOT insert or duplicate any <p>, <img>, <figure>, <em>, or <strong> tags.
- DO NOT modify or move <img src="..."> attributes in any way.
- DO NOT wrap the output in code blocks or Markdown.
- Do NOT normalize, validate, or correct HTML.
- Even if HTML appears invalid, output MUST preserve it exactly.
-If you add any tag not present in the input, the task is FAILED.

Original HTML content:
${text}

Now rewrite it following all rules above:
`;

// === HÀM GỌI ĐA PROVIDER ===
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
            console.log(`  Thành công với ${provider.name}`);
            console.log(text);
            console.log("-------------------------------------------------------------------------");

            console.log(result);
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

  console.error("🚫 Tất cả 4 provider và key đều lỗi → trả về text gốc");
  return text;
}

module.exports = { paraphraseText };