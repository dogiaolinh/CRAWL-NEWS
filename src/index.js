const { scrapeAll } = require("./scrapers/cnnScraper");

(async () => {
  try {
    await scrapeAll();
    console.log("HOÀN TẤT TOÀN BỘ!");
  } catch (err) {
    console.error("Lỗi:", err.message);
  }
})();