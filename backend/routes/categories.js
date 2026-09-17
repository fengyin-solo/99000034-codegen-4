const express = require('express');
const { getDb } = require('../db/init');
const { authMiddleware } = require('../middleware/auth');
const {
  CATEGORY_LIMIT,
  CATEGORY_NAME_MAX_LENGTH,
  normalizeCategoryName,
  categoryCompareKey,
} = require('../utils/category-rules');

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

// 返回某账号下与给定名称重名（忽略大小写/首尾及连续空格差异）的分类
function findDuplicateCategory(db, userId, name, excludeId = null) {
  const key = categoryCompareKey(name);
  const categories = db
    .prepare('SELECT id, name FROM categories WHERE user_id = ?')
    .all(userId);
  return categories.find((cat) => cat.id !== excludeId && categoryCompareKey(cat.name) === key) || null;
}

function getCategoryWithCount(db, id) {
  return db
    .prepare(`
      SELECT c.*, COUNT(l.id) as link_count
      FROM categories c
      LEFT JOIN links l ON c.id = l.category_id
      WHERE c.id = ?
      GROUP BY c.id
    `)
    .get(id);
}

// GET /api/categories - Get user's categories with link counts and usage info
router.get('/', (req, res) => {
  const userId = req.userId;
  const db = getDb();

  const categories = db
    .prepare(`
      SELECT c.*, COUNT(l.id) as link_count
      FROM categories c
      LEFT JOIN links l ON c.id = l.category_id
      WHERE c.user_id = ?
      GROUP BY c.id
      ORDER BY c.name
    `)
    .all(userId);

  res.json({
    categories,
    count: categories.length,
    limit: CATEGORY_LIMIT,
  });
});

// POST /api/categories - Create a category, or merge into an existing same-name one
router.post('/', (req, res) => {
  const rawName = req.body?.name;
  const { color } = req.body || {};
  const userId = req.userId;

  const name = normalizeCategoryName(rawName);
  if (!name) {
    return res.status(400).json({
      code: 'CATEGORY_NAME_REQUIRED',
      error: 'Category name is required',
    });
  }
  if (name.length > CATEGORY_NAME_MAX_LENGTH) {
    return res.status(400).json({
      code: 'CATEGORY_NAME_TOO_LONG',
      error: `Category name must not exceed ${CATEGORY_NAME_MAX_LENGTH} characters`,
      max_length: CATEGORY_NAME_MAX_LENGTH,
    });
  }

  const db = getDb();

  // 重名（含仅大小写/空格不同）：直接合并到已有分类，不再新建
  const existing = findDuplicateCategory(db, userId, name);
  if (existing) {
    const category = getCategoryWithCount(db, existing.id);
    return res.json({
      ...category,
      link_count: category.link_count,
      merged: true,
      message: 'Category already exists, merged into the existing one',
    });
  }

  // 容量上限：服务端强制拦截，绕过页面直接提交同样生效
  const { count } = db
    .prepare('SELECT COUNT(*) as count FROM categories WHERE user_id = ?')
    .get(userId);

  if (count >= CATEGORY_LIMIT) {
    return res.status(409).json({
      code: 'CATEGORY_LIMIT_REACHED',
      error: `Category limit reached (${count}/${CATEGORY_LIMIT})`,
      count,
      limit: CATEGORY_LIMIT,
    });
  }

  const result = db
    .prepare('INSERT INTO categories (user_id, name, color) VALUES (?, ?, ?)')
    .run(userId, name, color || '#409EFF');

  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ...category, link_count: 0, merged: false });
});

// PUT /api/categories/:id - Rename/recolor a category
// Renaming onto an existing name merges this category into that one.
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const rawName = req.body?.name;
  const { color } = req.body || {};
  const userId = req.userId;

  const db = getDb();

  const category = db
    .prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?')
    .get(id, userId);
  if (!category) {
    return res.status(404).json({
      code: 'CATEGORY_NOT_FOUND',
      error: 'Category not found',
    });
  }

  const nextName = rawName === undefined ? category.name : normalizeCategoryName(rawName);
  if (!nextName) {
    return res.status(400).json({
      code: 'CATEGORY_NAME_REQUIRED',
      error: 'Category name is required',
    });
  }
  if (nextName.length > CATEGORY_NAME_MAX_LENGTH) {
    return res.status(400).json({
      code: 'CATEGORY_NAME_TOO_LONG',
      error: `Category name must not exceed ${CATEGORY_NAME_MAX_LENGTH} characters`,
      max_length: CATEGORY_NAME_MAX_LENGTH,
    });
  }

  // 改名后与别的分类重名（忽略大小写/空格）：把当前分类的链接并入已有分类后删除自身
  const duplicate = findDuplicateCategory(db, userId, nextName, Number(id));
  if (duplicate) {
    const merge = db.transaction(() => {
      db.prepare('UPDATE links SET category_id = ? WHERE category_id = ?').run(duplicate.id, id);
      db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    });
    merge();

    const survivor = getCategoryWithCount(db, duplicate.id);
    return res.json({
      ...survivor,
      merged: true,
      removed_category_id: Number(id),
      message: 'Merged into the existing category',
    });
  }

  db.prepare('UPDATE categories SET name = ?, color = ? WHERE id = ?').run(
    nextName,
    color || category.color,
    id
  );

  const updated = getCategoryWithCount(db, id);
  res.json({ ...updated, merged: false });
});

// DELETE /api/categories/:id - Delete a category; its links fall back to uncategorized
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const userId = req.userId;

  const db = getDb();

  const category = db
    .prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?')
    .get(id, userId);
  if (!category) {
    return res.status(404).json({
      code: 'CATEGORY_NOT_FOUND',
      error: 'Category not found',
    });
  }

  const deleteWithLinks = db.transaction(() => {
    // 该分类下的链接回到“未分类”，列表和侧栏不会残留失效标签
    db.prepare('UPDATE links SET category_id = NULL WHERE category_id = ?').run(id);
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  });
  deleteWithLinks();

  const { count } = db
    .prepare('SELECT COUNT(*) as count FROM categories WHERE user_id = ?')
    .get(userId);

  res.json({
    message: 'Category deleted successfully',
    count,
    limit: CATEGORY_LIMIT,
  });
});

// GET /api/tags - Get all unique tags for user with counts
router.get('/tags', (req, res) => {
  const userId = req.userId;
  const db = getDb();

  const tags = db
    .prepare(`
      SELECT lt.tag, COUNT(*) as count
      FROM link_tags lt
      INNER JOIN links l ON lt.link_id = l.id
      WHERE l.user_id = ?
      GROUP BY lt.tag
      ORDER BY count DESC
    `)
    .all(userId);

  res.json(tags);
});

module.exports = router;
