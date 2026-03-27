// src/utils/fetchHtml.js
const axios = require("axios");
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
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1920,1080",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  try {
    const page = await browser.newPage();

    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    });

    // ✅ interactive-video loop mp4 URLs
    const videoUrls = [];

    // ✅ video-resource mp4 URLs (từ fave.api.cnn.io)
    const videoResourceMp4Urls = [];

    // ✅ FIX: Dùng Promise để chắc chắn biết khi nào fave.api respond xong
    let faveApiPendingCount = 0;
    let faveApiResolvers = [];

    await page.setRequestInterception(true);

    page.on("request", (req) => {
      const resourceType = req.resourceType();
      if (["font", "media"].includes(resourceType)) {
        req.abort();
        return;
      }
      const u = req.url();

      // ✅ Đếm số request đến fave.api để biết cần chờ bao nhiêu response
      if (u.includes("fave.api.cnn.io/v1/video")) {
        faveApiPendingCount++;
        console.log(`[FAVE-API] Request #${faveApiPendingCount}: ${u.substring(0, 80)}`);
      }

      // Bắt interactive-video loop mp4
      if (u.includes("media.cnn.com") && u.includes(".mp4")) {
        const wMatch = u.match(/w_(\d+)/);
        const width = wMatch ? parseInt(wMatch[1]) : 0;
        const slugMatch = u.match(/prod\/([^?]+\.mp4)/);
        const videoSlug = slugMatch ? slugMatch[1] : null;
        if (!videoSlug) { req.continue(); return; }
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

    // ✅ FIX: Bắt response từ fave.api.cnn.io và đếm ngược pending
    page.on("response", async (res) => {
      const u = res.url();
      if (u.includes("fave.api.cnn.io/v1/video")) {
        try {
          const json = await res.json();
          const fileUri =
            json?.video?.fileUri ||
            json?.fileUri ||
            json?.sources?.[0]?.fileUri;
          if (fileUri && fileUri.includes(".mp4")) {
            videoResourceMp4Urls.push(fileUri);
            console.log(`[VIDEO-RESOURCE] mp4: ${fileUri.substring(0, 80)}`);
          }
        } catch (_) {}

        // Giảm pending count, resolve nếu xong hết
        faveApiPendingCount--;
        if (faveApiPendingCount <= 0 && faveApiResolvers.length > 0) {
          faveApiResolvers.forEach(resolve => resolve());
          faveApiResolvers = [];
        }
      }
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    try {
      await page.waitForSelector(".article__content, .live-story-post__wrapper", {
        timeout: 15000,
      });
    } catch (_) {
      console.warn("[PUPPETEER] Không tìm thấy selector sau 15s, vẫn tiếp tục...");
    }

    // ✅ FIX: Chờ fave.api respond xong, hoặc timeout 8s nếu không có request nào
    if (faveApiPendingCount > 0) {
      console.log(`[FAVE-API] Đang chờ ${faveApiPendingCount} response từ fave.api.cnn.io...`);
      await Promise.race([
        // Chờ tất cả fave.api respond
        new Promise(resolve => { faveApiResolvers.push(resolve); }),
        // Timeout tối đa 8 giây
        new Promise(resolve => setTimeout(resolve, 8000)),
      ]);
      console.log(`[FAVE-API] Xong. Tìm thấy ${videoResourceMp4Urls.length} video mp4.`);
    } else {
      // Không có fave.api request → chờ thêm 3s phòng trường hợp lazy load
      console.log(`[FAVE-API] Không có request nào, chờ thêm 3s...`);
      await new Promise(r => setTimeout(r, 3000));

      // ✅ FIX: Sau 3s nếu vẫn có pending (lazy load sau domcontentloaded) thì chờ thêm
      if (faveApiPendingCount > 0) {
        console.log(`[FAVE-API] Phát hiện ${faveApiPendingCount} request lazy, chờ thêm 5s...`);
        await Promise.race([
          new Promise(resolve => { faveApiResolvers.push(resolve); }),
          new Promise(resolve => setTimeout(resolve, 5000)),
        ]);
        console.log(`[FAVE-API] Xong lazy load. Tìm thấy ${videoResourceMp4Urls.length} video mp4.`);
      }
    }

    const html = await page.content();
    console.log(`[DEBUG] HTML length: ${html.length}`);
    console.log(`[DEBUG] Has article__content: ${html.includes("article__content")}`);

    const finalUrls = videoUrls.map((v) => v.url);
    const injected = html.replace(
      "</body>",
      `<div id="__video_urls__" data-urls='${JSON.stringify(finalUrls)}'></div>` +
      `<div id="__video_resource_urls__" data-urls='${JSON.stringify(videoResourceMp4Urls)}'></div>` +
      `</body>`
    );
    return injected;
  } finally {
    await browser.close();
  }
}

module.exports = { fetchArticleHTML, fetchArticleHTMLWithJS };