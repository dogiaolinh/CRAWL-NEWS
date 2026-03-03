const { scrapeAll } = require("./scrapers/cnnScraper");
const { translateMissingVietnameseArticles } = require("./utils/translateVietnamese");

(async () => {
  try {
    await scrapeAll();
    await translateMissingVietnameseArticles()
    console.log("HOÀN TẤT TOÀN BỘ!");
  } catch (err) {
    console.error("Lỗi:", err.message);
  }
})();