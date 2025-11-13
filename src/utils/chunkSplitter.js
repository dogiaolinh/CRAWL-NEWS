// src/utils/chunkSplitter.js
function splitIntoChunks(html, maxSize = 7000) {
  const blocks = html.split(/(?=<p|<div|<figure|<ul|<ol|<blockquote|<section|<img)/g);
  const chunks = [];
  let currentChunk = "";

  for (const block of blocks) {
    // Nếu thêm block này mà vượt quá giới hạn → bắt đầu chunk mới
    if ((currentChunk + block).length > maxSize) {
      chunks.push(currentChunk);
      currentChunk = block;
    } else {
      currentChunk += block;
    }
  }

  if (currentChunk.trim()) chunks.push(currentChunk);
  return chunks;
}

module.exports = { splitIntoChunks };
