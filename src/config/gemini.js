// src/config/gemini.js
const API_KEYS = [
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
