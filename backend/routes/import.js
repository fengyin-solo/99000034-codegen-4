const express = require('express');
const multer = require('multer');
const { getDb } = require('../db/init');
const { authMiddleware } = require('../middleware/auth');
const { parseBookmarks } = require('../utils/bookmark-parser');
const {
  cleanCategoryName,
  sanitizeCategoryColor,
} = require('../utils/categoryPolicy');
const { getOrCreateCategoryForUser } = require('../utils/categoryStore');

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

  // Per-folder id cache so the limit/duplicate check runs once per folder
  const categoryIdByKey = new Map();
  const colors = ['#409EFF', '#67C23A', '#E6A23C', '#F56C6C', '#909399', '#9B59B6', '#1ABC9C', '#E74C3C'];

  function resolveCategoryId(folderName) {
    const clean = cleanCategoryName(folderName);
    if (!clean) return null;

    if (categoryIdByKey.has(clean.toLowerCase())) {
      return categoryIdByKey.get(clean.toLowerCase());
    }

    const color = colors[Math.floor(Math.random() * colors.length)];
    const { status, category } = getOrCreateCategoryForUser(
      userId,
      clean,
      sanitizeCategoryColor(color)
    );

    const id = status === 'limit' ? null : category.id;
    categoryIdByKey.set(clean.toLowerCase(), id);
    return id;
  }

  const insertLink = db.prepare(
    'INSERT INTO links (user_id, url, title, description, category_id, status) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const checkExists = db.prepare('SELECT id FROM links WHERE user_id = ? AND url = ?');

  let imported = 0;
  let skipped = 0;
  let uncategorizedByLimit = 0;
  const limitFolders = new Set();

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
        categoryId = resolveCategoryId(bookmark.folder);
        if (categoryId === null) {
          uncategorizedByLimit++;
          limitFolders.add(cleanCategoryName(bookmark.folder));
        }
      }

      insertLink.run(userId, bookmark.url, bookmark.title, '', categoryId, 'unchecked');
      imported++;
    }
  });

  importBookmarks();

  let message = `Successfully imported ${imported} bookmarks`;
  if (uncategorizedByLimit > 0) {
    message += `; ${uncategorizedByLimit} bookmarks kept uncategorized because the category limit was reached`;
  }

  res.json({
    message,
    imported,
    skipped,
    total: bookmarks.length,
    uncategorized_by_limit: uncategorizedByLimit,
    limit_folders: [...limitFolders],
  });
});

module.exports = router;
