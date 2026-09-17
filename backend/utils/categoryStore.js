/**
 * 分类归属与建类的共享数据层：
 * 所有需要"按名字找/建分类"或"校验分类归属"的入口（分类接口、
 * 链接接口、书签导入）都走这里，保证容量与重名口径一致。
 */
const { getDb } = require('../db/init');
const {
  CATEGORY_LIMIT,
  DEFAULT_CATEGORY_COLOR,
  normalizeCategoryName,
} = require('./categoryPolicy');

function countCategories(userId) {
  const db = getDb();
  const { count } = db
    .prepare('SELECT COUNT(*) as count FROM categories WHERE user_id = ?')
    .get(userId);
  return count;
}

function categoryBelongsToUser(userId, categoryId) {
  if (categoryId === null || categoryId === undefined) return true;
  const id = Number(categoryId);
  if (!Number.isInteger(id)) return false;
  const db = getDb();
  const row = db
    .prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?')
    .get(id, userId);
  return !!row;
}

/**
 * 按规范名查找已有分类；找不到且未超上限时新建。
 * * 不做名称清洗（调用方负责），返回 { status, category }
 *   status: 'existing' | 'created' | 'limit'
 */
function getOrCreateCategoryForUser(userId, name, color = DEFAULT_CATEGORY_COLOR) {
  const nameKey = normalizeCategoryName(name);
  if (!nameKey) return { status: 'limit', category: null };

  const db = getDb();

  const existing = db
    .prepare('SELECT * FROM categories WHERE user_id = ? AND name_key = ?')
    .get(userId, nameKey);
  if (existing) return { status: 'existing', category: existing };

  if (countCategories(userId) >= CATEGORY_LIMIT) {
    return { status: 'limit', category: null };
  }

  const result = db
    .prepare('INSERT INTO categories (user_id, name, name_key, color) VALUES (?, ?, ?, ?)')
    .run(userId, name, nameKey, color);
  const created = db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid);
  return { status: 'created', category: created };
}

module.exports = {
  countCategories,
  categoryBelongsToUser,
  getOrCreateCategoryForUser,
};
