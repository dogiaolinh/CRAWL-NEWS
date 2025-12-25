// src/utils/apiCaller.js
const axios = require("axios");
const { API_KEYS, buildGeminiUrl } = require("../config/gemini");

  async function callGeminiAPI(text, retries = 3) {
    const prompt = `
    You are a **senior English news editor** working for an independent international news outlet (NOT affiliated with CNN, BBC, or any specific brand).
    Your task is to **rewrite the following article** to create an original version that:
    - **Avoids any copyright infringement** by significantly rephrasing structure, sentence flow, and wording while preserving 100% of the factual content.
    - **Remains fully factual, neutral, and professional** — suitable for publication on a reputable global news site.

    🎯 **Core Requirements:**
    - **Preserve 100% of facts**: names, dates, numbers, direct quotes (in quotation marks), locations, events, timelines, and sources must remain **exactly** as in the original.
    - **Eliminate all references to "CNN" or any CNN-specific branding**:
      - Remove "(CNN)", "CNN.com", "Reporting by CNN", "CNN Exclusive", etc.
      - Replace reporter bylines like "By [Name], CNN" → "By [Name]" or remove if not essential to the story.
      - Do not imply affiliation with CNN in any way.
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
    Think like a skilled editor crafting an **original wire-style dispatch** from raw facts. 
    The output must read as if written from scratch by a different newsroom — **fact-for-fact identical**, but **linguistically unique**.
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

    let keyIndex = 0; // key hiện tại

    for (let attempt = 1; attempt <= retries; attempt++) {
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
        // console.log(`Ket qua Text: ${text}`);
        // console.log(`Ket qua Dich: ${result}`);
        return result || text;
      } catch (err) {
        const status = err.response?.status;

        console.error(
          `❌ Lỗi gọi Gemini (key ${keyIndex + 1}/${API_KEYS.length}, thử ${attempt}/${retries}):`,
          err.message
        );

        // 👉 Nếu bị rate limit thì đổi API key
        if (status === 429) {
          keyIndex++;

          if (keyIndex >= API_KEYS.length) {
            console.error("🚫 Đã hết API key khả dụng");
            return text;
          }

          console.warn(
            `🔁 Đổi sang API key ${keyIndex + 1}/${API_KEYS.length}`
          );
        }

        // Nếu đã retry hết
        if (attempt === retries) {
          return text;
        }
      }
    }
  }

module.exports = { callGeminiAPI };