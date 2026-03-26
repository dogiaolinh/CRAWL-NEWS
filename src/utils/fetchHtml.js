const axios = require("axios");
const puppeteer = require("puppeteer");

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
    headless: "new",
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  console.log(`[PUPPETEER] Browser đã khởi động`);

  try {
    const page = await browser.newPage();
    const videoUrls = [];

    // Log response status
    page.on("response", async (response) => {
      if (response.url() === url) {
        console.log(`[PUPPETEER] HTTP Status: ${response.status()} — ${response.url()}`);
      }
    });

    // Log console errors từ page
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.log(`[PAGE ERROR] ${msg.text()}`);
      }
    });

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

    console.log(`[PUPPETEER] Đang goto page...`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    console.log(`[PUPPETEER] Page đã load xong`);

    const html = await page.content();

    // ============ DEBUG BLOCK ============
    console.log(`\n========== DEBUG HTML ==========`);
    console.log(`[DEBUG] Page title    : ${(html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1] || "không có").trim()}`);
    console.log(`[DEBUG] HTML length   : ${html.length} ký tự`);
    console.log(`[DEBUG] Has <h1>      : ${/<h1/i.test(html)}`);
    console.log(`[DEBUG] Has article__content : ${html.includes("article__content")}`);
    console.log(`[DEBUG] Has live-story-post  : ${html.includes("live-story-post")}`);
    console.log(`[DEBUG] Has "Access Denied"  : ${html.includes("Access Denied")}`);
    console.log(`[DEBUG] Has "Just a moment"  : ${html.includes("Just a moment")}`);
    console.log(`[DEBUG] Has "Enable JavaScript" : ${html.includes("Enable JavaScript")}`);
    console.log(`[DEBUG] Has "cf-browser-verification" : ${html.includes("cf-browser-verification")}`);
    console.log(`[DEBUG] Has "recaptcha"      : ${html.toLowerCase().includes("recaptcha")}`);
    console.log(`[DEBUG] Has "subscribe"      : ${html.toLowerCase().includes("subscribe")}`);
    console.log(`[DEBUG] Has "paywall"        : ${html.toLowerCase().includes("paywall")}`);

    // In ra 2000 ký tự đầu để thấy cấu trúc thực tế
    console.log(`\n[DEBUG] --- 2000 ký tự đầu của HTML ---`);
    console.log(html.substring(0, 2000));
    console.log(`[DEBUG] --- HẾT ĐOẠN ĐẦU ---\n`);

    // In ra phần body (bỏ <head>) để thấy content thực
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      console.log(`[DEBUG] --- 3000 ký tự đầu của <body> ---`);
      console.log(bodyMatch[1].substring(0, 3000));
      console.log(`[DEBUG] --- HẾT BODY SNIPPET ---\n`);
    }
    console.log(`================================\n`);
    // ============ END DEBUG BLOCK ============

    const finalUrls = videoUrls.map(v => v.url);
    const injected = html.replace(
      "</body>",
      `<div id="__video_urls__" data-urls='${JSON.stringify(finalUrls)}'></div></body>`
    );
    return injected;
  } finally {
    await browser.close();
    console.log(`[PUPPETEER] Browser đã đóng`);
  }
}

module.exports = { fetchArticleHTML, fetchArticleHTMLWithJS };