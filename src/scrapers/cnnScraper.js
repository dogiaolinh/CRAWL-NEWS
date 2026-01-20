const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const { fetchArticleHTML } = require("../utils/fetchHtml");
const { splitIntoChunks } = require("../utils/chunkSplitter");
const { callGeminiAPI } = require("../utils/apiCaller");
const { postToAPI } = require("../api/postArticle");
const { uploadImage } = require("../api/uploadImage");
const axios = require("axios");
function extractCategoriesFromURL(url) {
  try {
    const u = new URL(url);
    const segments = u.pathname
      .split("/")
      .filter(seg => seg && seg.length > 1);  // bỏ slash và empty

    let categories = [];

    if (segments.length >= 3) {
      // Lấy 2 segment cuối trước slug
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

  // Tiêu đề chính của toàn bộ live blog (nếu có)
  // const mainTitle = $("h1.headline, h1").first().text().trim();
  // if (mainTitle) {
  //   contentBlocks.push(`<h1>${mainTitle}</h1>`);
  // }

  // Lấy tất cả các update (thường mới nhất ở trên)
  $(".live-story-post__wrapper").each((i, wrapper) => {
    const $wrapper = $(wrapper);

    const timestampEl = $wrapper.find(".live-story-post__timestamp");
    const timestamp = timestampEl.text().trim();
    const isActive = timestampEl.hasClass("active");
    const statusText = isActive ? " (Mới nhất)" : "";

    const headline = $wrapper.find(".live-story-post__headline").text().trim();
    const byline = $wrapper.find(".live-story-post__byline").text().trim();

    // Bắt đầu khối update
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

    // Nội dung chi tiết của update
    const $content = $wrapper.find(".live-story-post__content");

    $content.children().each((_, el) => {
      const $el = $(el);

      // Clean link CNN, Reuters,...
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

      // Paragraph
      if ($el.is("p.paragraph, p")) {
        const html = $el.html().trim();
        if (html) contentBlocks.push(`<p>${html}</p>`);
      }

      // Image với caption & credit
      else if ($el.hasClass("image") || $el.is('[data-component-name="image"]')) {
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
      }

      // Pull-quote
      else if ($el.is('aside[data-component-name="pull-quote"]') || $el.hasClass("pull-quote")) {
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

    contentBlocks.push("</div>"); // kết thúc update
  });

  return contentBlocks.join("\n");
}
async function checkSlugExists(slug) {
  try {
    const response = await axios.get(`https://www.todaynews.blog/api/check-slug/${slug}`);
    return response.data.exists === true;
  } catch (error) {
    console.error('Lỗi kiểm tra slug:', error);
    return false; // Nếu lỗi, giả sử không tồn tại để tránh block
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
      // console.log(link);
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
    `).each((_, el) => {      const $el = $home(el);
      const link = $el.find("a.container__link").attr("href") || $el.attr("data-open-link");
      // console.log(link);
      const title = $el.find(".container__headline-text").text().trim() || $el.find(".container__title_url-text").text().trim();
      // console.log(title);
      const img = $el.find("img").attr("src") || $el.find("video source").attr("src");
      // console.log(img);
      if (link && title) {
        const fullLink = link.startsWith("http") ? link : `https://edition.cnn.com${link}`;
        articles.push({ title, link: fullLink, thumbnail: img });
      }
    });

    console.log(`Tìm thấy ${articles.length} bài. Lấy 10 bài đầu để test.`);
    const selected = articles.slice(0, 10);

    for (const article of selected) {
      console.log(`\nXử lý: ${article.title}`);
      if (article.link.includes("video")) {
        console.log("Bỏ qua video.");
        continue;
      }

      let success = false;
      try {
        const html = await fetchArticleHTML(article.link);
        console.log(article.link);
        const $ = cheerio.load(html);
        const isEditorChoice = homepageLinks.has(article.link.split("?")[0]);
        const isLive =
          article.link.includes("/live-news/") ||
          $(".live-story-post__wrapper").length > 0;
        const pathParts = article.link.split("/").filter(Boolean);
        // const category = pathParts[pathParts.length - 2] || null;
        const slug = pathParts[pathParts.length - 1].split(".")[0] || null;
        console.log(slug);
        // Kiểm tra slug tồn tại
        const slugExists = await checkSlugExists(slug);
        if (slugExists) {
          if(isLive){
            await axios.delete(`https://www.todaynews.blog/api/article/${slug}`);
          }else{
            // Slug đã tồn tại → bỏ qua việc post bài này
            console.log(`Slug "${slug}" đã tồn tại, bỏ qua đăng bài.`);
            // Hoặc bạn có thể throw error, return, hoặc xử lý khác
            continue;
          }
        }
        const title = $("h1").first().text().trim() || article.title;
        let categories = extractCategoriesFromURL(baseURL);
        
        if (categories.length === 0) {
          // fallback sang breadcrumb nếu URL không có category rõ ràng
          $(".breadcrumb-elevate a").each((_, el) => {
            const c = $(el).text().trim();
            if (c) categories.push(c);
          });
        }

        // console.log("Categories:", categories);
        // Thumbnail riêng (ảnh đầu bài — ưu tiên lớn nhất)
        const thumbImg = $(".image_large__container img, .media__image img, img[data-src-large]").first();
        const thumbSrc = thumbImg.attr("data-src-large") || thumbImg.attr("data-src") || thumbImg.attr("src") || article.thumbnail;
        
        // === LẤY NỘI DUNG ===
        let content_html = "";
        const imageList = [];
        if (isLive) {
          console.log("Bài báo Live");
          content_html = extractLiveContent($);
        } else {
          const contentBlocks = [];

          // Lấy từng phần tử theo đúng thứ tự trong bài
          $(".article__content > *").each((_, el) => {
            const $el = $(el);

            // 1. Nếu là <p> — giữ nguyên HTML bên trong (có thể chứa <img>)
            if ($el.is("p")) {
              // 🧹 Xóa các thẻ <a> trỏ đến cnn.com, nhưng giữ lại text bên trong
              $el.find("a").each((_, a) => {
                const href = $(a).attr("href") || "";
                if (href.includes("cnn.com") || href.includes("outlook.com") || href.includes("reuters.com") ) {
                  $(a).replaceWith($(a).text());
                }
              });

              const innerHTML = $el.html().trim();
              if (innerHTML) {
                contentBlocks.push(`<p>${innerHTML}</p>`);
              }
            }

            // 2. Nếu là khối ảnh (div[data-component-name='image'] hoặc .image__container)
            else if ($el.is("div[data-component-name='image']") || $el.hasClass("image__container")) {
              const img = $el.find("img").first();
              const src = img.attr("data-src-large") || img.attr("data-src") || img.attr("src");
              const alt = img.attr("alt") || "";
              // const caption = $el.find("figcaption, .image__caption, .image__credit").text().trim();

              if (src) {
                const imgTag = `<img src="${src}" alt="${alt}">`;
                // const captionTag = caption ? `<em>${caption}</em>` : "";
                const captionTag = `<em>${alt}</em>`;
                contentBlocks.push(`<p style="text-align: center;">${imgTag}${captionTag}</p>`);
              }
            }
            else if ($el.hasClass("graphic-elevate") || $el.is("div[data-component-name='graphic']")) {
              const graphicAnchor = $el.find(".graphic__anchor").first();

              const pymSrc = graphicAnchor.attr("data-pym-src");
              const iframe = graphicAnchor.find("iframe").first();
              const iframeSrc = iframe.attr("src");

              const finalSrc = pymSrc || iframeSrc;
              if (finalSrc) {
                // Bạn có thể style theo ý riêng
                contentBlocks.push(`
                  <div style="margin: 20px 0;">
                    <iframe 
                      src="${finalSrc}" 
                      width="100%"
                      height="600"
                      style="border:none; overflow:hidden;"
                      scrolling="yes"
                      frameborder="0"
                    ></iframe>
                  </div>
                `);
              }
            }


            // 3. Bỏ qua các phần tử không cần (quảng cáo, script, v.v.)
          });

          content_html = contentBlocks.join("\n");
          // console.log(content_html);
          }

        if (!content_html.trim()) {
          console.log("Bỏ qua: không trích xuất được nội dung");
          continue;
        }
        // === 2. THU THẬP TẤT CẢ ẢNH TỪ content_html (đã giữ vị trí) ===
        const seenUrls = new Set();
        if (thumbSrc && !seenUrls.has(thumbSrc)) {
          seenUrls.add(thumbSrc);
          imageList.push({ url: thumbSrc, alt: thumbImg.attr("alt") || "", isThumbnail: true });
        }
        // Regex lấy tất cả src trong <img src="...">
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
        // console.log(imageList);
        // === 4. TẠO BÀI VIẾT TRƯỚC ===
        const { articleId } = await postToAPI({
          title,
          slug,
          content_html: "<p>Đang xử lý ảnh...</p>",
          published_at: new Date().toISOString().slice(0, 19).replace("T", " "),
          category_1 : categories[0],
          editor_choice: isEditorChoice,
          category_2: categories[1] || null,
        });
        await uploadImage("https://www.shutterstock.com/image-vector/breaking-news-sign-on-globe-600nw-2622724291.jpg", title, articleId);

        // console.log(content_html);
        // === 3. PARAPHRASE (giữ nguyên <img>) ===
        console.log("Đang chuyển đổi ngữ nghĩa...");
        const chunks = splitIntoChunks(content_html);
        let rewritten = "";
        for (const chunk of chunks) {
          rewritten += await callGeminiAPI(chunk);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        console.log("Đã chuyển đổi hoàn tất.");
        // console.log(rewritten);


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
          // Thay chính xác trong src=""
          const regex = new RegExp(`src=["']${oldUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'g');
          finalContent = finalContent.replace(regex, `src="${newUrl}"`);
        }

        // === 7. CẬP NHẬT BÀI VIẾT ===
        await axios.put(`https://www.todaynews.blog/api/edit/article/${articleId}`, {
          body: finalContent,
        }, { headers: { "Content-Type": "application/json" } });
        if(imageList.length > 0){
            await axios.delete(`https://www.todaynews.blog/api/delete/image/${articleId}`);
            console.log(`Đã xóa ảnh tạm đầu tiên`);
        }
        console.log(`HOÀN TẤT: ${title} (ID: ${articleId})`);
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

    // Lưu log
    const outputPath = path.join(__dirname, "../../cnn_results.json");
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), "utf8");
    console.log(`ĐÃ LƯU KẾT QUẢ VÀO cnn_results.json`);
  } catch (err) {
    console.error("Lỗi scrapeCNN:", err.message);
  }
}

module.exports = { scrapeAll };