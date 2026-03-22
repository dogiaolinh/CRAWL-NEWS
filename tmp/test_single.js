const { fetchArticleHTMLWithJS } = require('/Users/dogiaolinh/Downloads/CRAWL-NEWS/src/utils/fetchHtml');
const { postToAPI } = require('/Users/dogiaolinh/Downloads/CRAWL-NEWS/src/api/postArticle');
const cheerio = require('/Users/dogiaolinh/Downloads/CRAWL-NEWS/node_modules/cheerio');
const axios = require('/Users/dogiaolinh/Downloads/CRAWL-NEWS/node_modules/axios');

const TEST_URL = 'https://edition.cnn.com/2026/03/21/style/bts-arirang-comeback-concert-korea-intl-hnk';

(async () => {
  console.log('Fetching...');
  const html = await fetchArticleHTMLWithJS(TEST_URL);
  const $ = cheerio.load(html);

  const videoUrlsRaw = $('div#__video_urls__').attr('data-urls') || '[]';
  let videoUrls = [];
  try { videoUrls = JSON.parse(videoUrlsRaw); } catch(_) {}
  console.log('Video URLs:', videoUrls.length, 'clips');

  const title = $('h1').first().text().trim();
  console.log('Title:', title);

  const contentBlocks = [];
  $(".article__content > *").each((_, el) => {
    const $el = $(el);
    if ($el.is("p")) {
      const innerHTML = $el.html().trim();
      if (innerHTML) contentBlocks.push('<p>' + innerHTML + '</p>');
    }
    else if ($el.is("div[data-component-name='image']") || $el.hasClass("image__container")) {
      const img = $el.find("img").first();
      const src = img.attr("data-src-large") || img.attr("data-src") || img.attr("src");
      const alt = img.attr("alt") || "";
      if (src) contentBlocks.push('<p style="text-align:center;"><img src="' + src + '" alt="' + alt + '"></p>');
    }
    else if ($el.is('div[data-component-name="interactive-video"]') || $el.hasClass("interactive-video-elevate")) {
      const videoSrc = videoUrls.shift() || null;
      console.log('Video block gap, src:', videoSrc ? videoSrc.substring(0, 80) : 'NONE');
      if (videoSrc) {
        contentBlocks.push('<div style="margin:24px 0;text-align:center;"><video autoplay muted loop playsinline style="max-width:100%;border-radius:8px;"><source src="' + videoSrc + '" type="video/mp4"></video></div>');
      }
    }
  });

  const content_html = contentBlocks.join('\n');
  console.log('Content blocks:', contentBlocks.length);

  const slug = 'bts-arirang-test-video-1';
  const { articleId } = await postToAPI({
    title,
    slug,
    content_html,
    published_at: new Date().toISOString().slice(0, 19).replace("T", " "),
    category_1: 'style',
    editor_choice: false,
    category_2: null,
    isLive: false
  });
  console.log('Tao bai ID:', articleId);

  await axios.put('http://127.0.0.1:8000/api/edit/article/' + articleId, {
    body: content_html,
  }, { headers: { "Content-Type": "application/json" } });

  console.log('HOAN TAT! http://127.0.0.1:8000/en/articles/' + slug);
})().catch(console.error);