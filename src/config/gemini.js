// src/config/gemini.js
// debel , ku, setup , dglinh2
const API_KEYS = [
  "AIzaSyC3oD48RqZnyqCUy0kJQlVSbllGr8xcvAs",
  "AIzaSyCqnF_LUXCn2885FtHVHp5pJlSTUu1P-mY",
  "AIzaSyCegmt5zVysPYBQxQzXyuxdkgTEp0cW-Y8",
  "AIzaSyB4nJJxoC53UA6EzQA-2hMsMmf0ZMKXpDs",
  "AIzaSyCHiLWe7nI6d81dJKwjXog41bhf3Dr7E0E",
  "AIzaSyDH1kaG-srGtFVrN9vcQQlyRdFm-UJlw4w",
  "AIzaSyBVpoD2C3e6lg_Cgq1ecqqi7YKq2rixsJg",
  "AIzaSyBBHoZaBypNWBcGJ-BFaW-5W5_kUPqemAY",

  "AIzaSyCNpHtusiYak5L_3XGiNIvMCpmd5imD4bI",
  "AIzaSyCJajYCYyXrHEVwxOTgyKRMW8hzevahxkg",
  "AIzaSyBNojf23sAZ3SnXAXyfR4qYBygwPImo1uk",
];

const MODEL_NAME = "gemini-2.5-flash";

function buildGeminiUrl(apiKey) {
  return `https://generativelanguage.googleapis.com/v1/models/${MODEL_NAME}:generateContent?key=${apiKey}`;
}

module.exports = {
  API_KEYS,
  buildGeminiUrl,
};
