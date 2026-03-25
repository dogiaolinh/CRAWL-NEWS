// src/utils/fetchHtml.js
const axios = require("axios");
const puppeteer = require("puppeteer"); // ✅ Thêm dòng này

async function fetchArticleHTML(url) { // ✅ Giữ lại function cũ
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
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null, // ✅ Thêm dòng này
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",  
      "--disable-gpu",
    ],
  });
  try {
    const page = await browser.newPage();
    const videoUrls = []; // { slug, url, width }

    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const u = req.url();
      if (u.includes("media.cnn.com") && u.includes(".mp4")) {
        const wMatch = u.match(/w_(\d+)/);
        const width = wMatch ? parseInt(wMatch[1]) : 0;
        const slugMatch = u.match(/prod\/([^?]+\.mp4)/);
        const videoSlug = slugMatch ? slugMatch[1] : null;
        if (!videoSlug) { req.continue(); return; }

        const existing = videoUrls.find(v => v.slug === videoSlug);
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

    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    const html = await page.content();

    const finalUrls = videoUrls.map(v => v.url);
    const injected = html.replace(
      "</body>",
      `<div id="__video_urls__" data-urls='${JSON.stringify(finalUrls)}'></div></body>`
    );
    return injected;
  } finally {
    await browser.close();
  }
}

module.exports = { fetchArticleHTML, fetchArticleHTMLWithJS }; // ✅ Export cả 2