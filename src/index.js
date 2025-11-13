const { scrapeCNN } = require("./scrapers/cnnScraper");

(async () => {
  try {
    await scrapeCNN();
    console.log("HOÀN TẤT TOÀN BỘ!");
  } catch (err) {
    console.error("Lỗi:", err.message);
  }
})();