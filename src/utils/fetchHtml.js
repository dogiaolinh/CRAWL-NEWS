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

    const videoUrls = [];
    const videoResourceMp4Urls = [];
    let faveApiPendingCount = 0;
    let faveApiResolvers = [];

    await page.setRequestInterception(true);

    // ============ REQUEST HANDLER ============
    page.on("request", (req) => {
      const resourceType = req.resourceType();

      if (resourceType === "font") {
        req.abort();
        return;
      }

      const u = req.url();

      if (u.includes("fave.api.cnn.io/v1/video")) {
        faveApiPendingCount++;
        console.log(`[FAVE-API] Request #${faveApiPendingCount}: ${u.substring(0, 100)}`);
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

    // ============ RESPONSE HANDLER ============
    page.on("response", async (res) => {
      const u = res.url();
      if (!u.includes("fave.api.cnn.io/v1/video")) return;

      const finalize = () => {
        faveApiPendingCount--;
        console.log(`[FAVE-API] Còn lại: ${faveApiPendingCount}`);
        if (faveApiPendingCount <= 0 && faveApiResolvers.length > 0) {
          faveApiResolvers.forEach(resolve => resolve());
          faveApiResolvers = [];
        }
      };

      try {
        if (res.status() >= 300) {
          console.log(`[FAVE-DEBUG] Bỏ qua status ${res.status()}`);
          return;
        }

        let text = null;

        // Cách 1: buffer
        try {
          const buffer = await res.buffer();
          if (buffer && buffer.length > 0) text = buffer.toString("utf-8");
        } catch (_) {}

        // Cách 2: text()
        if (!text) {
          try { text = await res.text(); } catch (_) {}
        }

        // Cách 3: fetch lại trong browser context (bypass block CI)
        if (!text) {
          try {
            text = await page.evaluate(async (apiUrl) => {
              const r = await fetch(apiUrl, { credentials: "include" });
              return r.ok ? r.text() : null;
            }, u);
          } catch (_) {}
        }

        if (!text || text.trim() === "") {
          console.log(`[FAVE-DEBUG] Không đọc được body`);
          return;
        }

        const json = JSON.parse(text);
        console.log(`[FAVE-DEBUG] status: ${res.status()}`);
        console.log(`[FAVE-DEBUG] keys: ${Object.keys(json).join(", ")}`);
        console.log(`[FAVE-DEBUG] sample: ${JSON.stringify(json).substring(0, 300)}`);

        const fileUri =
          json?.video?.fileUri ||
          json?.fileUri ||
          json?.sources?.[0]?.fileUri ||
          json?.videoSources?.[0]?.fileUri ||
          json?.data?.fileUri;

        console.log(`[FAVE-DEBUG] fileUri: ${fileUri || "KHÔNG TÌM THẤY"}`);

        if (fileUri && fileUri.includes(".mp4")) {
          videoResourceMp4Urls.push(fileUri);
          console.log(`[VIDEO-RESOURCE] ✅ mp4: ${fileUri.substring(0, 100)}`);
        }

      } catch (e) {
        console.log(`[FAVE-DEBUG] Lỗi: ${e.message}`);
      } finally {
        finalize(); // ✅ chỉ gọi duy nhất 1 lần
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

    // Chờ fave.api respond xong
    if (faveApiPendingCount > 0) {
      console.log(`[FAVE-API] Đang chờ ${faveApiPendingCount} response...`);
      await Promise.race([
        new Promise(resolve => { faveApiResolvers.push(resolve); }),
        new Promise(resolve => setTimeout(resolve, 15000)), // ✅ tăng lên 15s
      ]);
      console.log(`[FAVE-API] Xong. Tìm thấy ${videoResourceMp4Urls.length} video mp4.`);
    } else {
      console.log(`[FAVE-API] Không có request nào, chờ thêm 5s...`);
      await new Promise(r => setTimeout(r, 5000));

      if (faveApiPendingCount > 0) {
        console.log(`[FAVE-API] Phát hiện lazy request, chờ thêm 10s...`);
        await Promise.race([
          new Promise(resolve => { faveApiResolvers.push(resolve); }),
          new Promise(resolve => setTimeout(resolve, 10000)), // ✅ tăng lên 10s
        ]);
        console.log(`[FAVE-API] Xong lazy. Tìm thấy ${videoResourceMp4Urls.length} video mp4.`);
      }
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