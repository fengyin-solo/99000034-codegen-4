const express = require('express');
const { getDb } = require('../db/init');
const { authMiddleware } = require('../middleware/auth');
const {
  CATEGORY_LIMIT,
  MAX_CATEGORY_NAME_LENGTH,
  cleanCategoryName,
  normalizeCategoryName,
  sanitizeCategoryColor,
} = require('../utils/categoryPolicy');

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

// GET /api/categories - Get user's categories with link counts
router.get('/', (req, res) => {
  const userId = req.userId;
  const db = getDb();

  const categories = db.prepare(`
    SELECT c.*, COUNT(l.id) as link_count
    FROM categories c
    LEFT JOIN links l ON c.id = l.category_id
    WHERE c.user_id = ?
    GROUP BY c.id
    ORDER BY c.name COLLATE NOCASE
  `).all(userId);

  res.json(categories);
});

// GET /api/categories/quota - Get category capacity usage for the account
router.get('/quota', (req, res) => {
  const userId = req.userId;
  const db = getDb();
  const { count } = db.prepare(
    'SELECT COUNT(*) as count FROM categories WHERE user_id = ?'
  ).get(userId);

  res.json({
    count,
    limit: CATEGORY_LIMIT,
    remaining: Math.max(0, CATEGORY_LIMIT - count),
    over_limit: count > CATEGORY_LIMIT,
  });
});

// GET /api/tags - Get all unique tags for user with counts
// NOTE: declared before it can be shadowed by other mounts
router.get('/tags', (req, res) => {
  const userId = req.userId;
  const db = getDb();

  const tags = db.prepare(`
    SELECT lt.tag, COUNT(*) as count
    FROM link_tags lt
    INNER JOIN links l ON lt.link_id = l.id
    WHERE l.user_id = ?
    GROUP BY lt.tag
    ORDER BY count DESC
  `).all(userId);

  res.json(tags);
});

// POST /api/categories - Create a category, or merge into an existing
// one when the name only differs by case/whitespace
router.post('/', (req, res) => {
  const rawName = req.body?.name;
  const userId = req.userId;

  const name = cleanCategoryName(rawName);
  if (!name) {
    return res.status(400).json({ error: '分类名称不能为空' });
  }
  if (name.length > MAX_CATEGORY_NAME_LENGTH) {
    return res.status(400).json({
      error: `分类名称不能超过 ${MAX_CATEGORY_NAME_LENGTH} 个字符`,
    });
  }
  const nameKey = normalizeCategoryName(name);
  const color = sanitizeCategoryColor(req.body?.color);

  const db = getDb();

  const result = db.transaction(() => {
    // Same normalized name already exists -> merge instead of creating
    const existing = db.prepare(
      'SELECT * FROM categories WHERE user_id = ? AND name_key = ?'
    ).get(userId, nameKey);
    if (existing) {
      return { merged: true, category: existing };
    }

    const { count } = db.prepare(
      'SELECT COUNT(*) as count FROM categories WHERE user_id = ?'
    ).get(userId);
    if (count >= CATEGORY_LIMIT) {
      return { limitReached: true, count };
    }

    const insertResult = db.prepare(
      'INSERT INTO categories (user_id, name, name_key, color) VALUES (?, ?, ?, ?)'
    ).run(userId, name, nameKey, color);

    const created = db.prepare('SELECT * FROM categories WHERE id = ?').get(
      insertResult.lastInsertRowid
    );
    return { merged: false, category: created };
  })();

  if (result.limitReached) {
    return res.status(409).json({
      error: `分类数量已达上限（${result.count}/${CATEGORY_LIMIT}），无法新增。请先删除不再使用的分类，或改用已有分类整理链接后再试。`,
      code: 'CATEGORY_LIMIT_REACHED',
      count: result.count,
      limit: CATEGORY_LIMIT,
    });
  }

  const category = db.prepare(`
    SELECT c.*, COUNT(l.id) as link_count
    FROM categories c
    LEFT JOIN links l ON c.id = l.category_id
    WHERE c.id = ?
    GROUP BY c.id
  `).get(result.category.id);

  res.status(200).json({ ...category, merged: result.merged });
});

// PUT /api/categories/:id - Rename / recolor a category
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const userId = req.userId;

  const db = getDb();

  const category = db.prepare(
    'SELECT * FROM categories WHERE id = ? AND user_id = ?'
  ).get(id, userId);
  if (!category) {
    return res.status(404).json({ error: '分类不存在' });
  }

  const name = cleanCategoryName(req.body?.name ?? category.name);
  if (!name) {
    return res.status(400).json({ error: '分类名称不能为空' });
  }
  if (name.length > MAX_CATEGORY_NAME_LENGTH) {
    return res.status(400).json({
      error: `分类名称不能超过 ${MAX_CATEGORY_NAME_LENGTH} 个字符`,
    });
  }
  const nameKey = normalizeCategoryName(name);
  const color = sanitizeCategoryColor(req.body?.color ?? category.color);

  // Renaming onto another category that only differs by case/whitespace
  // merges this category (and its links) into that one.
  const target = db.prepare(
    'SELECT * FROM categories WHERE user_id = ? AND name_key = ? AND id != ?'
  ).get(userId, nameKey, id);

  if (target) {
    db.transaction(() => {
      db.prepare('UPDATE links SET category_id = ? WHERE category_id = ?').run(target.id, id);
      db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    })();

    const merged = db.prepare(`
      SELECT c.*, COUNT(l.id) as link_count
      FROM categories c
      LEFT JOIN links l ON c.id = l.category_id
      WHERE c.id = ?
      GROUP BY c.id
    `).get(target.id);

    return res.json({ ...merged, merged: true, merged_from_id: Number(id) });
  }

  db.prepare(
    'UPDATE categories SET name = ?, name_key = ?, color = ? WHERE id = ?'
  ).run(name, nameKey, color, id);

  const updated = db.prepare(`
    SELECT c.*, COUNT(l.id) as link_count
    FROM categories c
    LEFT JOIN links l ON c.id = l.category_id
    WHERE c.id = ?
    GROUP BY c.id
  `).get(id);

  res.json({ ...updated, merged: false });
});

// DELETE /api/categories/:id - Delete a category; its links fall back to uncategorized
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const userId = req.userId;

  const db = getDb();

  const category = db.prepare(
    'SELECT * FROM categories WHERE id = ? AND user_id = ?'
  ).get(id, userId);
  if (!category) {
    return res.status(404).json({ error: '分类不存在' });
  }

  const { moved } = db.transaction(() => {
    const info = db.prepare(
      'UPDATE links SET category_id = NULL WHERE category_id = ?'
    ).run(id);
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    return { moved: info.changes };
  })();

  const { count } = db.prepare(
    'SELECT COUNT(*) as count FROM categories WHERE user_id = ?'
  ).get(userId);

  res.json({
    message: '分类已删除，其下链接已移至未分类',
    moved_links: moved,
    count,
    limit: CATEGORY_LIMIT,
    remaining: Math.max(0, CATEGORY_LIMIT - count),
  });
});

module.exports = router;
