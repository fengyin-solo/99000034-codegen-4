const express = require('express');
const multer = require('multer');
const { getDb } = require('../db/init');
const { authMiddleware } = require('../middleware/auth');
const { parseBookmarks } = require('../utils/bookmark-parser');
const { CATEGORY_LIMIT, normalizeCategoryName, categoryCompareKey } = require('../utils/category-rules');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// All routes require authentication
router.use(authMiddleware);

// POST /api/import/bookmarks - Import Chrome bookmarks
router.post('/bookmarks', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const html = req.file.buffer.toString('utf-8');
  const bookmarks = parseBookmarks(html);

  if (bookmarks.length === 0) {
    return res.status(400).json({ error: 'No valid bookmarks found in the file' });
  }

  const db = getDb();
  const userId = req.userId;

  // 与分类接口共用同一套命名口径：
  // - 名称先做 trim / 空格折叠
  // - 仅大小写、空格不同视为同一分类（合并复用，不新建）
  // - 已达上限时不再新建，链接归入“未分类”
  const colors = ['#409EFF', '#67C23A', '#E6A23C', '#F56C6C', '#909399', '#9B59B6', '#1ABC9C', '#E74C3C'];

  const getOrCreateCategory = db.transaction((folderName) => {
    const normalized = normalizeCategoryName(folderName);
    if (!normalized) return null;

    const existing = db
      .prepare('SELECT id, name FROM categories WHERE user_id = ?')
      .all(userId);
    const match = existing.find((cat) => categoryCompareKey(cat.name) === categoryCompareKey(normalized));
    if (match) {
      return match.id;
    }

    const { count } = db
      .prepare('SELECT COUNT(*) as count FROM categories WHERE user_id = ?')
      .get(userId);
    if (count >= CATEGORY_LIMIT) {
      return null; // 容量已满：链接仍会导入，只是不带分类
    }

    const color = colors[Math.floor(Math.random() * colors.length)];
    const result = db
      .prepare('INSERT INTO categories (user_id, name, color) VALUES (?, ?, ?)')
      .run(userId, normalized, color);
    return result.lastInsertRowid;
  });

  const insertLink = db.prepare(
    'INSERT INTO links (user_id, url, title, description, category_id, status) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const checkExists = db.prepare('SELECT id FROM links WHERE user_id = ? AND url = ?');

  let imported = 0;
  let skipped = 0;
  let uncategorizedByLimit = 0;

  const importBookmarks = db.transaction(() => {
    for (const bookmark of bookmarks) {
      // Skip if URL already exists for this user
      const existing = checkExists.get(userId, bookmark.url);
      if (existing) {
        skipped++;
        continue;
      }

      let categoryId = null;
      if (bookmark.folder && bookmark.folder !== 'Uncategorized') {
        categoryId = getOrCreateCategory(bookmark.folder);
        if (categoryId === null) uncategorizedByLimit++;
      }

      insertLink.run(userId, bookmark.url, bookmark.title, '', categoryId, 'unchecked');
      imported++;
    }
  });

  importBookmarks();

  res.json({
    message: `Successfully imported ${imported} bookmarks`,
    imported,
    skipped,
    uncategorized_by_limit: uncategorizedByLimit,
    total: bookmarks.length,
  });
});

module.exports = router;
