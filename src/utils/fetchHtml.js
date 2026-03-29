const axios = require("axios");
// ĐỔI: dùng puppeteer-extra thay vì puppeteer
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

async function fetchArticleHTML(url) {
  try {
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      timeout: 90000,
    });
    return data;
  } catch (err) {
    throw new Error(`Lỗi tải trang: ${err.message}`);
  }
}

async function fetchArticleHTMLWithJS(url) {
  console.log(`\n[PUPPETEER] Bắt đầu tải: ${url}`);

  const browser = await puppeteer.launch({
    headless: true, // ĐỔI: "new" → true (stealth hoạt động tốt hơn)
    // executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1920,1080",
      "--disable-blink-features=AutomationControlled", // THÊM
    ],
  });

  try {
    const page = await browser.newPage();

    // Giả lập trình duyệt thật
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    });

    const videoUrls = [];
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      // Block các request không cần để tải nhanh hơn
      const resourceType = req.resourceType();
      if (["font", "media"].includes(resourceType)) {
        req.abort();
        return;
      }
      const u = req.url();
      if (u.includes("media.cnn.com") && u.includes(".mp4")) {
        const wMatch = u.match(/w_(\d+)/);
        const width = wMatch ? parseInt(wMatch[1]) : 0;
        const slugMatch = u.match(/prod\/([^?]+\.mp4)/);
        const videoSlug = slugMatch ? slugMatch[1] : null;
        if (!videoSlug) {
          req.continue();
          return;
        }
        const existing = videoUrls.find((v) => v.slug === videoSlug);
        if (existing) {
          if (width > existing.width) {
            existing.url = u;
            existing.width = width;
          }
        } else {
          videoUrls.push({ slug: videoSlug, url: u, width });
        }
      }
      req.continue();
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Đợi nội dung thực sự xuất hiện
    try {
      await page.waitForSelector(".article__content, .live-story-post__wrapper", {
        timeout: 15000,
      });
    } catch (_) {
      console.warn("[PUPPETEER] Không tìm thấy selector sau 15s, vẫn tiếp tục...");
    }

    const html = await page.content();

    // Debug nhanh
    console.log(`[DEBUG] HTML length: ${html.length}`);
    console.log(`[DEBUG] Has article__content: ${html.includes("article__content")}`);

    const finalUrls = videoUrls.map((v) => v.url);
    const injected = html.replace(
      "</body>",
      `<div id="__video_urls__" data-urls='${JSON.stringify(finalUrls)}'></div></body>`
    );
    return injected;
  } finally {
    await browser.close();
  }
}

module.exports = { fetchArticleHTML, fetchArticleHTMLWithJS };