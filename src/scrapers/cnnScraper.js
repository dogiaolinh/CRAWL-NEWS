const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const { fetchArticleHTML } = require("../utils/fetchHtml");
const { splitIntoChunks } = require("../utils/chunkSplitter");
const { callGeminiAPI } = require("../utils/apiCaller");
const { postToAPI } = require("../api/postArticle");
const { uploadImage } = require("../api/uploadImage");
const axios = require("axios");

async function scrapeCNN() {
  const baseURL = "https://edition.cnn.com/world";
  const results = [];

  try {
    console.log("Truy cập CNN Home...");
    const homeHTML = await fetchArticleHTML(baseURL);
    const $home = cheerio.load(homeHTML);
    const articles = [];

    $home("div.stack__items li.card").each((_, el) => {
      const $el = $home(el);
      const link = $el.find("a.container__link").attr("href");
      // console.log(link);
      const title = $el.find(".container__headline-text").text().trim();
      // console.log(title);
      const img = $el.find("img").attr("src") || $el.find("video source").attr("src");
      if (link && title) {
        const fullLink = link.startsWith("http") ? link : `https://edition.cnn.com${link}`;
        articles.push({ title, link: fullLink, thumbnail: img });
      }
    });

    console.log(`Tìm thấy ${articles.length} bài. Lấy 5 bài đầu để test.`);
    const selected = articles.slice(0, 5);

    for (const article of selected) {
      console.log(`\nXử lý: ${article.title}`);
      if (article.link.includes("video")) {
        console.log("Bỏ qua video.");
        continue;
      }

      let success = false;
      try {
        const html = await fetchArticleHTML(article.link);
        const $ = cheerio.load(html);

        const pathParts = article.link.split("/").filter(Boolean);
        // const category = pathParts[pathParts.length - 2] || null;
        // console.log(category);
        const slug = pathParts[pathParts.length - 1].split(".")[0] || null;
        const title = $("h1").first().text().trim() || article.title;
        // Lấy category (breadcrumb)
        const categories = [];
        $(".breadcrumb-elevate a").each((_, el) => {
          const category = $(el).text().trim();
          if (category) categories.push(category);
        });

        // Thumbnail riêng (ảnh đầu bài — ưu tiên lớn nhất)
        const thumbImg = $(".image_large__container img, .media__image img, img[data-src-large]").first();
        const thumbSrc = thumbImg.attr("data-src-large") || thumbImg.attr("data-src") || thumbImg.attr("src") || article.thumbnail;
        // === 1. LẤY NỘI DUNG HTML — GIỮ NGUYÊN CẤU TRÚC + VỊ TRÍ ẢNH ===
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

          // 3. Bỏ qua các phần tử không cần (quảng cáo, script, v.v.)
        });

        let content_html = contentBlocks.join("\n");
        console.log(content_html);
        if (!content_html || content_html.trim() === "") {
          console.log("Bỏ qua bài báo vì không có nội dung");
          continue;
        }
        // === 2. THU THẬP TẤT CẢ ẢNH TỪ content_html (đã giữ vị trí) ===
        const imageList = [];
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
        // === 4. TẠO BÀI VIẾT TRƯỚC ===
        const { articleId } = await postToAPI({
          title,
          slug,
          content_html: "<p>Đang xử lý ảnh...</p>",
          published_at: new Date().toISOString().slice(0, 19).replace("T", " "),
          category_1 : categories[0],
          editor_choice: true,
          category_2: categories[1] || null,

        });

        // console.log(content_html);
        // === 3. PARAPHRASE (giữ nguyên <img>) ===
        console.log("Đang chuyển đổi ngữ nghĩa...");
        const chunks = splitIntoChunks(content_html);
        let rewritten = "";
        for (const chunk of chunks) {
          rewritten += await callGeminiAPI(chunk);
        }
        console.log("Đã chuyển đổi hoàn tất.");
        // console.log(rewritten);


        // === 5. UPLOAD ẢNH ===
        console.log(`Upload ${imageList.length} ảnh...`);
        if(imageList.length == 0){
          await uploadImage("https://img.freepik.com/premium-photo/futuristic-tech-interface-data-analysis-digital-network_1110022-23878.jpg", title, articleId);
        }
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
        await axios.put(`http://127.0.0.1:8000/api/edit/article/${articleId}`, {
          body: finalContent,
        }, { headers: { "Content-Type": "application/json" } });

        console.log(`HOÀN TẤT: ${title} (ID: ${articleId})`);
        success = true;
        console.log("Đợi 5s!");
        await new Promise(r => setTimeout(r, 5000));
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

module.exports = { scrapeCNN };