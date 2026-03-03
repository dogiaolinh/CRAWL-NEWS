// src/utils/translateToVietnamese.js
require("dotenv").config();
const axios = require("axios");
const { splitIntoChunks } = require("../utils/chunkSplitter");

// === CẤU HÌNH CÁC PROVIDER (giữ nguyên từ apiCaller.js của anh) ===
const PROVIDERS = [
//   {
//     name: "Gemini",
//     keys: process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(",").map(k => k.trim()) : [],
//     urlBuilder: (key) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
//     format: "gemini",
//     model: "gemini-2.5-flash",
//   },
  {
    name: "Groq",
    keys: process.env.GROQ_API_KEYS ? process.env.GROQ_API_KEYS.split(",").map(k => k.trim()) : [],
    url: "https://api.groq.com/openai/v1/chat/completions",
    format: "openai",
    model: "llama-3.1-8b-instant", // model nhanh, rẻ, dịch tốt
  },
  {
    name: "Mistral",
    keys: process.env.MISTRAL_API_KEYS ? process.env.MISTRAL_API_KEYS.split(",").map(k => k.trim()) : [],
    url: "https://api.mistral.ai/v1/chat/completions",
    format: "openai",
    model: "mistral-large-latest",
  },
  // Có thể thêm DeepSeek hoặc OpenRouter nếu anh muốn
];

// === PROMPT DỊCH CHUYÊN BIỆT (giữ nguyên cấu trúc HTML, phong cách báo chí) ===
const createBodyTranslatePrompt = (text) => `
### 🧠 Strict Technical Constraints (Top Priority):
- **NO AUTO-FIX**: Do not attempt to fix, balance, or complete HTML tags. If a </div> exists without a opening <div>, leave it exactly like that.
- **NO WRAPPING**: Do not wrap the output in any new <div>, <body>, or <html> tags.
- **NO INDENTATION**: Do not add any new tabs or spaces at the beginning of lines that weren't there.
- **IDENTICAL ENDING**: The output must end at the exact same character/tag as the input. If the input ends with a word, do not add a newline or a tag.
- **FORBIDDEN TAGS**: Do not insert any <div> tags that are not present in the original text.

You are a **senior bilingual news editor** working for TodayNews, translating English articles into Vietnamese.
Your task is to **translate the following content** into natural, professional Vietnamese news style while:
- **Preserving 100% of the factual content** — names, dates, numbers, quotes, locations, events, timelines must remain exactly as in the original.
- **Maintaining exact HTML structure** — keep all <p>, <img>, <figure>, <em>, <strong>, <ul>, <li>, etc. in the same order, nesting, and attributes.
- **Rephrasing for natural Vietnamese flow** — use idiomatic Vietnamese journalistic language, vary sentence structure, but do NOT change facts or meaning.

🎯 **Core Requirements:**
- Translate title and body content naturally into Vietnamese.
- Keep direct quotes in English if they are proper names or official statements, but translate surrounding text.
- Remove any CNN-specific attribution (e.g., "CNN", "By [Name], CNN") — replace with neutral "By TodayNews" or omit if not essential.
- **Do NOT** add, remove, or invent any information.
- **Do NOT** insert any new HTML tags (especially <div>).
- **Do NOT** wrap output in code blocks or quotes.

Original content (may contain HTML):
${text}

Now translate it following all rules above. Output only the translated content:
`;

// === PROMPT RIÊNG CHO TITLE (ngắn gọn, một dòng, loại bỏ byline) ===
const createTitleTranslatePrompt = (title) => `
Dịch tiêu đề sau sang tiếng Việt tự nhiên, ngắn gọn, phong cách báo chí chuyên nghiệp, giữ nguyên 100% ý nghĩa gốc. Chỉ trả về tiêu đề dịch (một dòng duy nhất, không xuống dòng, không thêm "By", "From", tên tác giả, ngoặc, hoặc attribution nào):

"${title}"
`;

// === HÀM DỊCH TEXT (dùng prompt tương ứng) ===
async function translateText(text, isTitle = false) {
  if (!text?.trim()) return text;

  const delayBetweenRequests = 5000; // 5 giây giữa mỗi request

  const prompt = isTitle ? createTitleTranslatePrompt(text) : createBodyTranslatePrompt(text);

  for (const provider of PROVIDERS) {
    if (provider.keys.length === 0) {
      console.warn(`Provider ${provider.name} không có key → bỏ qua`);
      continue;
    }

    let keyIndex = 0;
    let attempts = 0;
    const maxAttempts = 3 * provider.keys.length;

    while (attempts < maxAttempts) {
      const apiKey = provider.keys[keyIndex];

      try {
        let response;

        if (provider.format === "gemini") {
          response = await axios.post(provider.urlBuilder(apiKey), {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 8192,
              topP: 0.95,
            },
          }, { timeout: 180000 });
          const result = response.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (result) {
            console.log(`  Dịch thành công với ${provider.name}`);
            return result;
          }
        } else {
          response = await axios.post(provider.url, {
            model: provider.model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
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
          if (result && result.length > 50) { // title/body dịch phải có độ dài tối thiểu
            console.log(`  Dịch thành công với ${provider.name}`);
            return result;
          }
        }

        throw new Error("Kết quả không hợp lệ");

      } catch (err) {
        const status = err.response?.status;

        if ([429, 503, 402].includes(status)) {
          console.warn(`  Rate limit / hết balance → chờ ${delayBetweenRequests / 1000}s...`);
          await new Promise(r => setTimeout(r, delayBetweenRequests));
        } else if ([401, 403].includes(status)) {
          console.warn(`  Key invalid/blocked → bỏ key này`);
        }

        keyIndex = (keyIndex + 1) % provider.keys.length;
        attempts++;

        if (attempts >= maxAttempts) {
          console.warn(`  Hết key của ${provider.name} → chuyển provider tiếp theo`);
          break;
        }
      }
    }
  }

  console.error("🚫 Tất cả provider đều lỗi → trả về text gốc");
  return text;
}

// === TOOL CHÍNH: Dịch các bài thiếu tiếng Việt ===
async function translateMissingVietnameseArticles() {
  const GET_URL = "https://www.todaynews.blog/api/articles/missing-vi";
  const POST_BASE_URL = "https://www.todaynews.blog/api/articles/";

  try {
    console.log("Đang lấy danh sách bài thiếu tiếng Việt...");
    const response = await axios.get(GET_URL);
    const articles = response.data;

    if (!Array.isArray(articles) || articles.length === 0) {
      console.log("Không có bài nào thiếu tiếng Việt");
      return { success: 0, failed: 0 };
    }

    console.log(`Tìm thấy ${articles.length} bài cần dịch sang tiếng Việt`);

    let successCount = 0;
    let failedCount = 0;

    for (const article of articles) {
      const { id, title, body } = article;

      console.log(`\n=== Xử lý bài ID: ${id} ===`);

      // Dịch title (dùng prompt riêng cho title)
      const translatedTitleRaw = await translateText(title, true); // isTitle = true
      // Clean title: xóa xuống dòng, cắt ngắn nếu quá dài (tránh lỗi 1406)
      let translatedTitle = translatedTitleRaw
        .replace(/\s*\n\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const maxTitleLength = 255; // điều chỉnh theo schema DB
      if (translatedTitle.length > maxTitleLength) {
        translatedTitle = translatedTitle.substring(0, maxTitleLength - 3) + '...';
      }
    //   console.log(`Title dịch: ${translatedTitle}`);

      // Dịch body (dùng prompt riêng cho body)
    //   console.log("Đang chia và dịch body...");
      const chunks = splitIntoChunks(body);
      let translatedBody = "";

      for (const chunk of chunks) {
        const translatedChunk = await translateText(chunk, false); // isTitle = false
        translatedBody += translatedChunk + "\n\n";
        await new Promise(r => setTimeout(r, 3000)); // delay chunk
      }
      translatedBody = translatedBody.trim();

      // Đẩy lên API POST
      try {
        const postResponse = await axios.post(`${POST_BASE_URL}${id}/translate`, {
          lang: "vi",
          title: translatedTitle,
          body: translatedBody,
        }, {
          headers: { "Content-Type": "application/json" },
          timeout: 30000,
        });

        console.log(`Đẩy thành công bài ID ${id}:`, postResponse.data.message);
        successCount++;
      } catch (postErr) {
        console.error(`Lỗi đẩy bài ID ${id}:`, postErr.message);
        failedCount++;
      }

      // Delay giữa các bài
      await new Promise(r => setTimeout(r, 5000));
    }

    console.log(`\nHoàn tất: Thành công ${successCount}/${articles.length}, Thất bại ${failedCount}`);
    return { success: successCount, failed: failedCount, total: articles.length };

  } catch (error) {
    console.error("Lỗi tổng thể:", error.message);
    return { success: 0, failed: 0, total: 0 };
  }
}
// (async () => {
//   try {
//     let = text = "<p>Venezuela's Acting President Delcy Rodríguez has spoken out against the US, saying she's had enough of Washington's orders, as she seeks to unite the country after the US capture of its former leader Nicolás Maduro.</p><p>Since being appointed as interim leader with US backing, Rodríguez has walked a delicate tightrope, balancing her government's loyalty to Maduro with the need to appease the White House.</p><p>Now, almost a month into her new role, Rodríguez has pushed back against the US, amid ongoing pressure, including demands for Venezuela to resume oil production.</p>";
//     let test = await translateMissingVietnameseArticles();
//     console.log(test);
//   } catch (err) {
//     console.error("Lỗi:", err.message);
//   }
// })();
module.exports = { translateMissingVietnameseArticles };