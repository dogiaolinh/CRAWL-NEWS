const axios = require("axios");
const FormData = require("form-data");

async function uploadImage(imageUrl, altText, articleId) {
  try {
    const res = await axios.get(imageUrl, { responseType: "arraybuffer" });
    const buffer = Buffer.from(res.data);

    const form = new FormData();
    form.append("image", buffer, { filename: `img_${Date.now()}.jpg` });
    form.append("alt_text", altText || "");
    form.append("imageable_type", "Modules\\Article\\App\\Models\\Article");
    form.append("imageable_id", articleId);
    form.append("user_id", 1);

    const uploadRes = await axios.post("https://www.todaynews.blog/api/images/upload", form, {
      headers: form.getHeaders(),
      timeout: 60000,
    });

    const newUrl = uploadRes.data?.data?.file_path || uploadRes.data?.url;
    if (!newUrl) throw new Error("Không nhận được URL ảnh");

    console.log(`Upload ảnh: ${imageUrl} → ${newUrl}`);
    return newUrl; // → /storage/images/2025/11/...
  } catch (err) {
    console.error(`Lỗi upload ảnh: ${err.response?.data || err.message}`);
    return imageUrl; // Fallback
  }
}

module.exports = { uploadImage };