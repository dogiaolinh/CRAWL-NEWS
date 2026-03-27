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

// ✅ Gọi fave.api trực tiếp bằng axios (Node.js) - không qua browser
async function fetchFaveApiMp4(faveApiUrl) {
  try {
    const { data, status } = await axios.get(faveApiUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Referer": "https://edition.cnn.com/",
        "Origin": "https://edition.cnn.com",
      },
      timeout: 15000,
    });

    // ✅ Thêm debug
    console.log(`[FAVE-AXIOS] HTTP ${status}, type: ${typeof data}`);
    console.log(`[FAVE-AXIOS] Response sample: ${JSON.stringify(data).substring(0, 200)}`);

    const fileUri =
      data?.video?.fileUri ||
      data?.fileUri ||
      data?.sources?.[0]?.fileUri ||
      data?.videoSources?.[0]?.fileUri ||
      data?.data?.fileUri;

    if (fileUri && fileUri.includes(".mp4")) {
      console.log(`[VIDEO-RESOURCE] ✅ mp4: ${fileUri.substring(0, 100)}`);
      return fileUri;
    }

    console.log(`[FAVE-AXIOS] Không tìm thấy fileUri. Keys: ${Object.keys(data || {}).join(", ")}`);
    return null;
  } catch (e) {
    // ✅ Log chi tiết lỗi
    console.log(`[FAVE-AXIOS] Lỗi ${e.response?.status || "no-status"}: ${e.message}`);
    if (e.response?.data) {
      console.log(`[FAVE-AXIOS] Response body: ${JSON.stringify(e.response.data).substring(0, 200)}`);
    }
    return null;
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

    const videoUrls = [];
    const videoResourceMp4Urls = [];

    // ✅ Chỉ lưu URL fave.api, KHÔNG đếm pending nữa
    const faveApiUrlsSeen = new Set();
    const faveApiUrlsCollected = [];

    // ✅ Flag: chỉ thu thập trong lúc page đang load, bỏ qua retry sau
    let collectingFaveUrls = true;

    await page.setRequestInterception(true);

    // ============ REQUEST HANDLER ============
    page.on("request", (req) => {
      const resourceType = req.resourceType();

      if (resourceType === "font") {
        req.abort();
        return;
      }

      const u = req.url();

      // ✅ Thu thập URL fave.api (deduplicate, bỏ qua retry)
      if (u.includes("fave.api.cnn.io/v1/video") && collectingFaveUrls) {
        // Lấy phần id để dedup
        const idMatch = u.match(/[?&]id=([^&]+)/);
        const videoId = idMatch ? idMatch[1] : u;
        if (!faveApiUrlsSeen.has(videoId)) {
          faveApiUrlsSeen.add(videoId);
          faveApiUrlsCollected.push(u);
          console.log(`[FAVE-API] Thu thập URL #${faveApiUrlsCollected.length}: ${u.substring(0, 100)}`);
        }
      }

      if (u.includes("media.cnn.com") && u.includes(".mp4")) {
        const wMatch = u.match(/w_(\d+)/);
        const width = wMatch ? parseInt(wMatch[1]) : 0;
        const slugMatch = u.match(/(?:loops\/stellar\/prod|prod)\/([^?]+\.mp4)/);
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

    // ✅ Không cần RESPONSE HANDLER nữa - bỏ hoàn toàn

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    try {
      await page.waitForSelector(".article__content, .live-story-post__wrapper", {
        timeout: 15000,
      });
    } catch (_) {
      console.warn("[PUPPETEER] Không tìm thấy selector sau 15s, vẫn tiếp tục...");
    }

    // ✅ Chờ thêm 3s để thu thập hết URL fave.api từ lần load đầu
    await new Promise(r => setTimeout(r, 3000));

    // ✅ Dừng thu thập - bỏ qua mọi retry sau này
    collectingFaveUrls = false;

    console.log(`[FAVE-API] Tổng URL thu thập: ${faveApiUrlsCollected.length}`);

    // ✅ Gọi trực tiếp bằng axios từ Node.js (bypass block CI)
    if (faveApiUrlsCollected.length > 0) {
      console.log(`[FAVE-AXIOS] Đang fetch ${faveApiUrlsCollected.length} URL bằng axios...`);
      const results = await Promise.all(
        faveApiUrlsCollected.map(u => fetchFaveApiMp4(u))
      );
      results.forEach(mp4 => {
        if (mp4) videoResourceMp4Urls.push(mp4);
      });
      console.log(`[FAVE-AXIOS] Tìm thấy ${videoResourceMp4Urls.length} mp4.`);
    }

    const html = await page.content();
    console.log(`[DEBUG] HTML length: ${html.length}`);
    console.log(`[DEBUG] Has article__content: ${html.includes("article__content")}`);
    console.log(`[VIDEO] interactive-video URLs: ${videoUrls.length}, video-resource URLs: ${videoResourceMp4Urls.length}`);

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