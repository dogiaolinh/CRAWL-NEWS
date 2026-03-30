const cheerio = require("cheerio");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());const fs = require("fs");
const path = require("path");
const { fetchArticleHTML, fetchArticleHTMLWithJS } = require("../utils/fetchHtml");
const { splitIntoChunks } = require("../utils/chunkSplitter");
const { paraphraseText } = require("../utils/apiCaller");
const { postToAPI } = require("../api/postArticle");
const { uploadImage } = require("../api/uploadImage");
const axios = require("axios");

function extractCategoriesFromURL(url) {
  try {
    const u = new URL(url);
    const segments = u.pathname
      .split("/")
      .filter(seg => seg && seg.length > 1);

    let categories = [];

    if (segments.length >= 3) {
      categories = segments.slice(-3, -1);
    } else if (segments.length === 2) {
      categories = segments.slice(0, 2);
    } else if (segments.length === 1) {
      categories = segments;
    }
    return categories;
  } catch (e) {
    return [];
  }
}

function extractLiveContent($) {
  const contentBlocks = [];

  $(".live-story-post__wrapper").each((i, wrapper) => {
    const $wrapper = $(wrapper);

    const timestampEl = $wrapper.find(".live-story-post__timestamp");
    const timestamp = timestampEl.text().trim();
    const isActive = timestampEl.hasClass("active");
    const statusText = isActive ? " (Mới nhất)" : "";

    const headline = $wrapper.find(".live-story-post__headline").text().trim();
    const byline = $wrapper.find(".live-story-post__byline").text().trim();

    contentBlocks.push(
      `<div class="live-update" style="margin-bottom: 40px; padding: 20px; background: #f9f9f9; border-radius: 8px; border-left: 4px solid #c00;">`
    );

    if (headline) {
      contentBlocks.push(`<h3 style="margin: 0 0 10px 0; color: #c00;">${headline}</h3>`);
    }

    if (timestamp) {
      contentBlocks.push(
        `<div style="color: #555; font-size: 0.95em; margin-bottom: 16px;">
          ${timestamp ? `<time>${timestamp}${statusText}</time>` : ""}
        </div>`
      );
    }

    const $content = $wrapper.find(".live-story-post__content");

    $content.children().each((_, el) => {
      const $el = $(el);

      $el.find("a").each((_, a) => {
        const href = $(a).attr("href") || "";
        if (
          href.includes("cnn.com") ||
          href.includes("outlook.com") ||
          href.includes("reuters.com")
        ) {
          $(a).replaceWith($(a).text());
        }
      });

      if ($el.is("p.paragraph, p")) {
        const html = $el.html().trim();
        if (html) contentBlocks.push(`<p>${html}</p>`);
      } else if ($el.hasClass("image") || $el.is('[data-component-name="image"]')) {
        const src =
          $el.find("img.image__dam-img").attr("src") ||
          $el.find("img").attr("data-src") ||
          $el.find("img").attr("src");

        const alt = $el.find("img").attr("alt") || "";
        const caption = $el.find(".image__caption").text().trim() || alt;
        const credit = $el.find(".image__credit").text().trim();

        if (src) {
          const captionHTML = caption
            ? `<div style="font-size:0.9em; color:#444; margin-top:8px;">${caption}</div>`
            : "";
          const creditHTML = credit
            ? `<div style="font-size:0.85em; color:#777; margin-top:4px;">${credit}</div>`
            : "";

          contentBlocks.push(
            `<figure style="margin: 24px 0; text-align:center;">
              <img src="${src}" alt="${alt}" style="max-width:100%; height:auto; border-radius:4px;">
              ${captionHTML}
              ${creditHTML}
            </figure>`
          );
        }
      } else if ($el.is('aside[data-component-name="pull-quote"]') || $el.hasClass("pull-quote")) {
        const quoteText =
          $el.find(".pull-quote_block-quote__text").html() ||
          $el.find("p").first().html();
        if (quoteText) {
          contentBlocks.push(
            `<blockquote style="border-left: 5px solid #999; padding-left: 20px; margin: 32px 0; font-style: italic; color: #333; font-size: 1.1em;">
              ${quoteText}
            </blockquote>`
          );
        }
      }
    });

    contentBlocks.push("</div>");
  });

  return contentBlocks.join("\n");
}

async function extractVideoLink(articleUrl) {
  let videoLink = null;

  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(90000);

    // Theo dõi response để bắt link .mpd
    page.on('response', (response) => {
      const url = response.url();
      if (url.includes('.mpd')) {
        console.log(`[VIDEO] Tìm thấy .mpd: ${url}`);
        
        // Ưu tiên fallback để tránh quảng cáo
        if (url.includes('fallback') || !url.includes('ctx=')) {
          videoLink = url;
          console.log(`→ Chọn FALLBACK manifest (tránh quảng cáo)`);
        } 
        else if (!videoLink) {
          videoLink = url;
          console.log(`→ Chọn MASTER manifest`);
        }
      }
    });

    // Load trang
    await page.goto(articleUrl, { 
      waitUntil: 'networkidle2', 
      timeout: 90000 
    });

    console.log("[PUPPETEER] Đang scroll và click nút Play...");

    // Scroll xuống để video xuất hiện
    await page.evaluate(() => {
      window.scrollBy(0, 600);
    });
    await new Promise(r => setTimeout(r, 3000));

    // Tìm và click nút Play (dùng selector anh cung cấp)
    const playButtonSelectors = [
      'button.sc-dhoNoI.jFXs.pui_center-controls_big-play-toggle',
      '.video__play-button',
      '.media__play-button',
      '.vjs-big-play-button',
      'button[aria-label="Play"]',
      '.play-icon'
    ];

    let clicked = false;

    for (const selector of playButtonSelectors) {
      try {
        const button = await page.$(selector);
        if (button) {
          console.log(`→ Tìm thấy nút Play với selector: ${selector}`);
          await button.click();
          clicked = true;
          console.log("→ Đã click nút Play");
          break;
        }
      } catch (e) {
        // tiếp tục thử selector khác
      }
    }

    if (!clicked) {
      console.log("Không tìm thấy nút Play, thử click vào vùng video...");
      // Click vào vùng video nếu không tìm thấy nút
      await page.click('.video-resource, .media__video, .video-player').catch(() => {});
    }

    // Chờ manifest load sau khi click
    await new Promise(r => setTimeout(r, 2000));

    await browser.close();

    if (videoLink) {
      console.log(`✅ Tìm thấy video link: ${videoLink}`);
    } else {
      console.log("❌ Vẫn không tìm thấy .mpd nào sau khi click Play");
    }

    return videoLink;

  } catch (err) {
    console.error(`Lỗi Puppeteer cho ${articleUrl}:`, err.message);
    return null;
  }
}

async function checkSlugExists(slug) {
  try {
    const response = await axios.get(`https://www.todaynews.blog/api/check-slug/${slug}`);
    return response.data.exists === true;
  } catch (error) {
    console.error('Lỗi kiểm tra slug:', error);
    return false;
  }
}

async function scrapeAll() {
  const baseURLs = [
    "https://edition.cnn.com/",
    "https://edition.cnn.com/world",

    "https://edition.cnn.com/us",
    "https://edition.cnn.com/health/life-but-better/fitness",

    "https://edition.cnn.com/politics",
    "https://edition.cnn.com/politics/president-donald-trump-47",
    "https://edition.cnn.com/politics/fact-check",
    "https://edition.cnn.com/entertainment",
    "https://edition.cnn.com/entertainment/movies",
    "https://edition.cnn.com/entertainment/tv-shows",
    "https://edition.cnn.com/entertainment/celebrities",
    "https://edition.cnn.com/weather",
    "https://edition.cnn.com/business",
    "https://edition.cnn.com/business/tech",
    "https://edition.cnn.com/business/media",
    "https://edition.cnn.com/style",
    "https://edition.cnn.com/style/arts",
    "https://edition.cnn.com/style/fashion",
    "https://edition.cnn.com/style/beauty",
    "https://edition.cnn.com/style/design",
    "https://edition.cnn.com/sport",
    "https://edition.cnn.com/sport/football",
    "https://edition.cnn.com/sport/tennis",
    "https://edition.cnn.com/sport/golf",
    "https://edition.cnn.com/sport/motorsport",
    "https://edition.cnn.com/health",
    "https://edition.cnn.com/health/life-but-better/sleep",
    "https://edition.cnn.com/health/life-but-better/mindfulness",
    "https://edition.cnn.com/health/life-but-better/relationships",
    "https://edition.cnn.com/world/china",
    "https://edition.cnn.com/world/europe/ukraine",
    "https://edition.cnn.com/travel",
    "https://edition.cnn.com/travel/news",
    "https://edition.cnn.com/travel/food-and-drink",
    "https://edition.cnn.com/climate",
    "https://edition.cnn.com/us/crime-and-justice",
    "https://edition.cnn.com/science",
    "https://edition.cnn.com/science/space"

  ];
  for (const baseURL of baseURLs) {
    await scrapeCNN(baseURL);
  }
}

async function scrapeCNN(baseURL) {

  const results = [];

  try {
    console.log("Truy cập CNN Home...");
    const homepageHTML = await fetchArticleHTML("https://edition.cnn.com");
    const $homePage = cheerio.load(homepageHTML);

    const homepageLinks = new Set();

    $homePage("a.container__link, a[data-link-type='article']").each((_, el) => {
      let link = $homePage(el).attr("href");
      if (!link) return;
      if (!link.startsWith("http")) link = "https://edition.cnn.com" + link;
      homepageLinks.add(link.split("?")[0]);
    });

    console.log(`Trang chủ có ${homepageLinks.size} bài.`);
    console.log("Truy cập danh mục...");
    const homeHTML = await fetchArticleHTML(baseURL);
    const $home = cheerio.load(homeHTML);
    const articles = [];

    $home(`
      .container_spotlight-package .container_spotlight-package__field-links .card,
      .container_lead-plus-headlines-with-images li.card,
      .container_lead-plus-headlines__cards-wrapper li.card,
      .container_vertical-strip__cards-wrapper li.card,
      .zone__items.layout--balanced-4 .container_lead-plus-headlines__cards-wrapper li.card,
      div.stack__items li.card
    `).each((_, el) => {
      const $el = $home(el);
      const link = $el.find("a.container__link").attr("href") || $el.attr("data-open-link");
      const title = $el.find(".container__headline-text").text().trim() || $el.find(".container__title_url-text").text().trim();
      const img = $el.find("img").attr("src") || $el.find("video source").attr("src");
      if (link && title) {
        const fullLink = link.startsWith("http") ? link : `https://edition.cnn.com${link}`;
        articles.push({ title, link: fullLink, thumbnail: img });
      }
    });

    console.log(`Tìm thấy ${articles.length} bài. Lấy 30 bài đầu để test.`);
    const selected = articles.slice(0, 30);


    for (const article of selected) {
      console.log(`\nXử lý: ${article.title}`);
      console.log(`\nXử lý: ${article.title}`);
      console.log(`🔗 CNN: ${article.link}`); // ✅ thêm dòng này

      // ✅ FIX 1: Bỏ qua các URL không có article content
      // const videoOnlyPatterns = [
      //   "/videos/fast/",
      //   "/videos/live/",
      //   "/video/playlists/",
      //   "/world/video/",
      //   "/politics/video/",
      //   "/business/video/",
      //   "/entertainment/video/",
      //   "/health/video/",
      //   "/style/video/",
      //   "/travel/video/",
      //   "/sport/video/",
      //   "/us/video/",
      //   "/science/video/",
      //   "/climate/video/",
      //   "/interactive/",  // ✅ bỏ qua trang interactive (không có article__content)
      // ];
      // if (videoOnlyPatterns.some(p => article.link.includes(p))) {
      //   console.log("Bỏ qua trang không hỗ trợ.");
      //   continue;
      // }

      // ✅ FIX 2: isVideo chỉ true khi path thực sự là /video/ hoặc /videos/
      // Tránh nhận nhầm bài báo có chữ "video" trong slug (vd: viral-video-china-dogs)
      let isVideo = false;
      try {
        const videoPathPattern = /\/(videos?|video)\//i;
        isVideo = videoPathPattern.test(new URL(article.link).pathname);
      } catch(_) {}

      let success = false;
      try {
        const html = await fetchArticleHTMLWithJS(article.link);
        console.log(article.link);
        const $ = cheerio.load(html);
        const isEditorChoice = homepageLinks.has(article.link.split("?")[0]);
        const isLive =
          article.link.includes("/live-news/") ||
          $(".live-story-post__wrapper").length > 0;
        const pathParts = article.link.split("/").filter(Boolean);
        const slug = pathParts[pathParts.length - 1].split(".")[0] || null;
        console.log(slug);

        const slugExists = await checkSlugExists(slug);
        if (slugExists) {
          if (isLive) {
            await axios.delete(`https://www.todaynews.blog/api/article/${slug}`);
          } else {
            console.log(`Slug "${slug}" đã tồn tại, bỏ qua đăng bài.`);
            continue;
          }
        }

        const title = $("h1").first().text().trim() || article.title;
        let categories;
        if (isVideo) {
          categories = extractCategoriesFromURL(article.link);
        } else {
          categories = extractCategoriesFromURL(baseURL);
        }

        if (categories.length === 0) {
          $(".breadcrumb-elevate a").each((_, el) => {
            const c = $(el).text().trim();
            if (c) categories.push(c);
          });
        }

        const thumbImg = $(".image_large__container img, .media__image img, img[data-src-large]").first();
        const thumbSrc = thumbImg.attr("data-src-large") || thumbImg.attr("data-src") || thumbImg.attr("src") || article.thumbnail;

        // === LẤY NỘI DUNG ===
        let content_html = "";
        const imageList = [];

        if (isLive) {
          console.log("Bài báo Live");
          content_html = extractLiveContent($);

        } else if (isVideo) {
          console.log("Video thuần (CNN Video page)");
          const videoLink = await extractVideoLink(article.link);
          const contentBlocks = [];
          if (videoLink) {
            let description = $('.video-resource__description p, [data-editable="description"] p').text().trim() || '';
            description = description.replace(/\(CNN\)/gi, '').trim();

            const videoEmbed = `
              <div style="margin: 20px 0; text-align: center; max-width: 100%; width: 100%;">
    
                  <!-- Container responsive giữ tỉ lệ -->
                  <div style="position: relative; width: 100%; max-width: 1280px; margin: 0 auto; background: #000; border-radius: 8px; overflow: hidden; aspect-ratio: 16 / 9;">
                      
                      <video 
                          id="video-player" 
                          controls 
                          style="width: 100%; height: 100%; display: block;"
                          playsinline>
                      </video>
                      
                  </div>

                  ${description ? `
                  <p style="margin-top: 12px; font-style: italic; color: #555; text-align: center; padding: 0 10px;">
                      ${description}
                  </p>` : ''}

                  <script src="https://cdn.dashjs.org/latest/dash.all.min.js"></script>
                  <script>
                      (function() {
                          const videoElement = document.getElementById("video-player");
                          if (!videoElement) return;

                          const url = "${videoLink}";

                          const player = dashjs.MediaPlayer().create();
                          
                          // Cấu hình DASH player tốt hơn
                          player.updateSettings({
                              'streaming': {
                                  'abr': { 'enabled': true },
                                  'buffer': { 'fastSwitchEnabled': true }
                              }
                          });

                          player.initialize(videoElement, url, false);

                          player.on(dashjs.MediaPlayer.events.ERROR, function(e) {
                              console.error("Lỗi phát DASH:", e);
                          });

                          // Tự động resize khi thay đổi kích thước cửa sổ
                          window.addEventListener('resize', () => {
                              player.resize();
                          });
                      })();
                  </script>
              </div>
            `;
            contentBlocks.push(videoEmbed);
            content_html = contentBlocks.join("\n");
          } else {
            console.log("Không tìm thấy manifest .dash.mpd");
          }

        } else {
          console.log("Bài báo thường");

          const contentBlocks = [];

          // Parse video URLs được inject bởi fetchArticleHTMLWithJS
          const videoUrlsRaw = $("div#__video_urls__").attr("data-urls") || "[]";
          let videoUrls = [];
          try { videoUrls = JSON.parse(videoUrlsRaw); } catch(_) {}

          const videoResourceUrlsRaw = $("div#__video_resource_urls__").attr("data-urls") || "[]";
          let videoResourceUrls = [];
          try { videoResourceUrls = JSON.parse(videoResourceUrlsRaw); } catch(_) {}

          console.log(`[VIDEO] interactive-video URLs: ${videoUrls.length}, video-resource URLs: ${videoResourceUrls.length}`);

          $(".article__content > *").each((_, el) => {
            const $el = $(el);

            // ✅ FIX 3: Nhận đúng paragraph CNN dùng class "paragraph-elevate"
            if (
              $el.is("p") ||
              $el.hasClass("paragraph-elevate") ||
              $el.attr("data-component") === "paragraph"
            ) {
              $el.find("a").each((_, a) => {
                const href = $(a).attr("href") || "";
                if (href.includes("cnn.com") || href.includes("outlook.com") || href.includes("reuters.com")) {
                  $(a).replaceWith($(a).text());
                }
              });
              const innerHTML = $el.html().trim();
              if (innerHTML) {
                contentBlocks.push(`<p>${innerHTML}</p>`);
              }
            }

            // ✅ FIX 4: Nhận thêm class "image-elevate" cho ảnh CNN mới
            else if (
              $el.is("div[data-component-name='image']") ||
              $el.hasClass("image__container") ||
              $el.hasClass("image-elevate")
            ) {
              const img = $el.find("img").first();
              const src = img.attr("data-src-large") || img.attr("data-src") || img.attr("src");
              const alt = img.attr("alt") || "";
              if (src) {
                contentBlocks.push(
                  `<p style="text-align: center;"><img src="${src}" alt="${alt}"><em>${alt}</em></p>`
                );
              }
            }

            else if ($el.hasClass("graphic-elevate") || $el.is("div[data-component-name='graphic']")) {
              const graphicAnchor = $el.find(".graphic__anchor").first();
              const pymSrc = graphicAnchor.attr("data-pym-src");
              const iframe = graphicAnchor.find("iframe").first();
              const iframeSrc = iframe.attr("src");
              const finalSrc = pymSrc || iframeSrc;
              if (finalSrc) {
                contentBlocks.push(`
                  <div style="margin: 20px 0;">
                    <iframe src="${finalSrc}" width="100%" height="600"
                      style="border:none; overflow:hidden;" scrolling="yes" frameborder="0">
                    </iframe>
                  </div>
                `);
              }
            }

            // ✅ Video loop ngắn (gif-style) trong bài báo thường
            else if (
              $el.is('div[data-component-name="interactive-video"]') ||
              $el.hasClass("interactive-video-elevate")
            ) {
              const videoSrc = videoUrls.shift() || null;
              if (videoSrc) {
                contentBlocks.push(
                  '<div style="margin:24px 0;">' +
                  '<video autoplay muted loop playsinline width="100%" style="border-radius:8px;display:block;">' +
                  '<source src="' + videoSrc + '" type="video/mp4">' +
                  '</video>' +
                  '</div>'
                );
              }
            }

            // ✅ Video có controls (video-resource) trong bài báo thường
            else if (
              $el.is('div[data-component-name="video-resource"]') ||
              $el.hasClass("video-resource") ||
              $el.hasClass("video-resource-elevate")  // ✅ FIX 5: thêm class mới CNN dùng
            ) {
              const videoSrc = videoResourceUrls.shift() || null;
              if (videoSrc) {
                contentBlocks.push(
                  '<div style="margin:24px 0;">' +
                  '<video controls width="100%" style="border-radius:8px;display:block;">' +
                  '<source src="' + videoSrc + '" type="video/mp4">' +
                  '</video>' +
                  '</div>'
                );
              } else {
                // ✅ FIX 6: Fallback - nếu không có mp4 từ fave.api, thử lấy từ data-src trong element
                const fallbackSrc =
                  $el.find("video source").attr("src") ||
                  $el.find("video").attr("src");
                if (fallbackSrc) {
                  contentBlocks.push(
                    '<div style="margin:24px 0;">' +
                    '<video controls width="100%" style="border-radius:8px;display:block;">' +
                    '<source src="' + fallbackSrc + '" type="video/mp4">' +
                    '</video>' +
                    '</div>'
                  );
                }
              }
            }
          });

          content_html = contentBlocks.join("\n");
        }

        let cate_2 = !isVideo ? categories[1] : null;

        if (!content_html.trim()) {
          console.log(`\n[CONTENT DEBUG] Không trích xuất được nội dung cho: ${article.link}`);
          console.log(`[CONTENT DEBUG] .article__content tồn tại       : ${$(".article__content").length > 0}`);
          console.log(`[CONTENT DEBUG] .article__content > * count      : ${$(".article__content > *").length}`);
          console.log(`[CONTENT DEBUG] p.paragraph count                : ${$("p.paragraph").length}`);
          console.log(`[CONTENT DEBUG] h1 text                          : "${$("h1").first().text().trim().substring(0, 80)}"`);
          console.log(`[CONTENT DEBUG] Các class div đầu tiên trong body:`);
          $("body > div").slice(0, 5).each((i, el) => {
            console.log(`  div[${i}] class="${$(el).attr("class") || ""}"`);
          });
          console.log(``);
          continue;
        }

        // === 2. THU THẬP TẤT CẢ ẢNH TỪ content_html ===
        const seenUrls = new Set();
        if (thumbSrc && !seenUrls.has(thumbSrc)) {
          seenUrls.add(thumbSrc);
          imageList.push({ url: thumbSrc, alt: thumbImg.attr("alt") || "", isThumbnail: true });
        }
        const srcMatches = content_html.match(/<img[^>]+src=["'](.*?)["']/gi) || [];
        srcMatches.forEach(match => {
          const srcMatch = match.match(/src=["'](.*?)["']/i);
          if (srcMatch && srcMatch[1]) {
            const url = srcMatch[1];
            if (!seenUrls.has(url)) {
              seenUrls.add(url);
              imageList.push({ url, alt: "", isThumbnail: false });
            }
          }
        });

        // === 4. TẠO BÀI VIẾT TRƯỚC ===
        const { articleId } = await postToAPI({
          title,
          slug,
          content_html: "<p>Đang xử lý ảnh...</p>",
          published_at: new Date().toISOString().slice(0, 19).replace("T", " "),
          category_1: categories[0],
          editor_choice: isEditorChoice,
          category_2: cate_2,
          isLive
        });
        await uploadImage("https://www.shutterstock.com/image-vector/breaking-news-sign-on-globe-600nw-2622724291.jpg", title, articleId);

        // === 3. PARAPHRASE ===
        console.log("Đang chuyển đổi ngữ nghĩa...");
        const chunks = splitIntoChunks(content_html);
        let rewritten = "";
        if (!isVideo) {
          for (const chunk of chunks) {
            rewritten += await paraphraseText(chunk);
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        } else {
          rewritten = content_html;
        }
        console.log("Đã chuyển đổi hoàn tất.");

        // === 5. UPLOAD ẢNH ===
        console.log(`Upload ${imageList.length} ảnh...`);
        const urlMap = new Map();
        for (const img of imageList) {
          const newUrl = await uploadImage(img.url, img.alt, articleId);
          urlMap.set(img.url, newUrl);
        }

        // === 6. THAY URL TRONG HTML ĐÃ PARAPHRASE ===
        let finalContent = rewritten;
        for (const [oldUrl, newUrl] of urlMap) {
          const regex = new RegExp(`src=["']${oldUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'g');
          finalContent = finalContent.replace(regex, `src="${newUrl}"`);
        }

        // === 7. CẬP NHẬT BÀI VIẾT ===
        await axios.put(`https://www.todaynews.blog/api/edit/article/${articleId}`, {
          body: finalContent,
        }, { headers: { "Content-Type": "application/json" } });

        if (imageList.length > 0) {
          await axios.delete(`https://www.todaynews.blog/api/delete/image/${articleId}`);
          console.log(`Đã xóa ảnh tạm đầu tiên`);
        }

        console.log(`HOÀN TẤT: ${title} (ID: ${articleId})`);
        console.log(`✅ Đã đăng: https://www.todaynews.blog/${slug}`); // ✅ thêm dòng này
        success = true;
        console.log("Đợi 3s!");
        await new Promise(r => setTimeout(r, 3000));
        results.push({
          title,
          url: article.link,
          articleId,
          images: imageList.length
        });

      } catch (err) {
        console.error(`Lỗi: ${err.message}`);
      }
      if (!success) console.log(`Bỏ qua: ${article.title}`);
    }

    const outputPath = path.join(__dirname, "../../cnn_results.json");
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), "utf8");
    console.log(`ĐÃ LƯU KẾT QUẢ VÀO cnn_results.json`);

  } catch (err) {
    console.error("Lỗi scrapeCNN:", err.message);
  }
}

module.exports = { scrapeAll };