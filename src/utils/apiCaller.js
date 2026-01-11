// src/utils/apiCaller.js
const axios = require("axios");
const { API_KEYS, buildGeminiUrl } = require("../config/gemini");
let keyIndex = 0;
  async function callGeminiAPI(text, retries = 7) {
    const prompt = `
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
    - Output must be valid, browser-parsable HTML.
    
    Original HTML content:
    ${text}

    Now rewrite it following all rules above:
    `;


    for (let i = 0; i < API_KEYS.length; i++) {
      const apiKey = API_KEYS[keyIndex];
      const GEMINI_URL = buildGeminiUrl(apiKey);

      try {
        const response = await axios.post(
          GEMINI_URL,
          {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.8,
              maxOutputTokens: 8192,
              topP: 0.95,
            },
          },
          {
            headers: { "Content-Type": "application/json" },
            timeout: 180000,
          }
        );

        const result =
          response.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

        return result || text;
      } catch (err) {
        const status = err.response?.status;

        console.error(
          `❌ Gemini lỗi (key ${i + 1}/${API_KEYS.length})`,
        );
        // 👉 nếu là lỗi cuối cùng → fallback
        if (i === API_KEYS.length - 1) {
          console.error("🚫 Tất cả API key đều lỗi");
          return text;
        }
        keyIndex = (keyIndex + 1) % API_KEYS.length;

        console.warn(`🔁 Chuyển sang API key ${i + 2}`);
      }
    }
  }

module.exports = { callGeminiAPI };