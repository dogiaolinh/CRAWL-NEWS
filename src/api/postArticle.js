const axios = require("axios");

const BASE_URL = "https://www.todaynews.blog/api";

function formatCategoryName(name) {
  return name
    .replace(/-/g, " ")                // đổi dấu gạch thành space
    .replace(/\b\w/g, c => c.toUpperCase());  // viết hoa chữ cái đầu
}

// 🧠 Tìm category theo tên (hàm tái sử dụng)
async function findCategoryByName(name) {
  const res = await axios.get(`${BASE_URL}/categories`);
  const categories = res.data?.data || res.data || [];
  const check_name = formatCategoryName(name);
  return categories.find(
    (cat) => {
      const normalize = (str) => str.toLowerCase().trim().replace(/s$/, "");
      return normalize(cat.name) === normalize(check_name);
    }
  );
}

// 🧠 Tạo mới category con nếu chưa có
async function createChildCategory(name, parentId) {
  const slug = name.toLowerCase().replace(/\s+/g, "-");
  const nameCate = formatCategoryName(name);
  const res = await axios.post(
    `${BASE_URL}/categories`,
    {
      name: nameCate,
      slug,
      parent_id: parentId,
    },
    { headers: { "Content-Type": "application/json" } }
  );

  return res.data?.data?.id || res.data?.id;
}

// 🧠 Tạo bài viết
async function postToAPI(article) {
  try {
    let categoryId = 1;
    let parentCategoryId = null;

    // ✅ 1. Tìm category cha (đã có sẵn trong DB)
    if (article.category_1) {
      let parentCat = await findCategoryByName(article.category_1);

      // ❗ Nếu không có → tạo mới category cha
      if (!parentCat) {
        const slug = article.category_1.toLowerCase().replace(/\s+/g, "-");

        const newParent = await axios.post(
          `${BASE_URL}/categories`,
          {
            name: formatCategoryName(article.category_1),
            slug,
            parent_id: null,
          },
          { headers: { "Content-Type": "application/json" } }
        );

        parentCat = newParent.data?.data || newParent.data;
        console.log(`🆕 Tạo category cha: ${article.category_1}`);
      }

      parentCategoryId = parentCat.id;
      categoryId = parentCat.id;
    }

    // ✅ 2. Nếu có danh mục con, kiểm tra hoặc tạo mới
    if (article.category_2) {
      const existingChild = await findCategoryByName(article.category_2);

      if (existingChild) {
        categoryId = existingChild.id;
      } else {
        const newChildId = await createChildCategory(article.category_2, parentCategoryId);
        categoryId = newChildId;
        console.log(`🆕 Tạo danh mục con: ${article.category_2} (parent_id=${parentCategoryId})`);
      }
    }

    // ✅ 3. Gửi bài viết lên
    const payload = {
      title: article.title,
      slug: article.slug,
      body: article.content_html || "<p>Đang xử lý...</p>",
      published_at:
        article.published_at ||
        new Date().toISOString().slice(0, 19).replace("T", " "),
      editor_choice: article.editor_choice,
      type: "news",
      status: 1,
      category_id: categoryId,
      user_id: 1,
      is_live: article.isLive,
    };

    const res = await axios.post(`${BASE_URL}/articles`, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 30000,
    });

    const articleId = res.data?.data?.id || res.data?.id;
    if (!articleId) throw new Error("Không lấy được ID bài viết");

    console.log(
      `✅ Tạo bài viết thành công: ${article.title} → category_id = ${categoryId}`
    );
    return { articleId};
  } catch (error) {
    console.error("❌ Lỗi tạo bài:", error.response?.data || error.message);
    throw error;
  }
}

module.exports = { postToAPI };
