const Database = require('better-sqlite3');
const path = require('path');
const { normalizeCategoryName, categoryCompareKey } = require('../utils/category-rules');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'links.db');

function migrateDatabase() {
  const db = new Database(DB_PATH);

  try {
    const tableInfo = db.pragma('table_info(links)');
    const columns = tableInfo.map((col) => col.name);

    if (!columns.includes('is_read_later')) {
      db.exec('ALTER TABLE links ADD COLUMN is_read_later INTEGER DEFAULT 0');
      console.log('Added column: is_read_later');
    }

    if (!columns.includes('review_date')) {
      db.exec('ALTER TABLE links ADD COLUMN review_date DATETIME');
      console.log('Added column: review_date');
    }

    if (!columns.includes('review_status')) {
      db.exec("ALTER TABLE links ADD COLUMN review_status TEXT DEFAULT 'pending' CHECK(review_status IN ('pending', 'completed', 'skipped'))");
      console.log('Added column: review_status');
    }

    normalizeAndDedupeCategories(db);

    console.log('Database migration completed successfully');
  } catch (error) {
    console.error('Migration error:', error);
  } finally {
    db.close();
  }
}

/**
 * 老数据治理（幂等，可重复执行）：
 * 1. 规范化已有分类名称（去首尾空格、折叠连续空白）
 * 2. 合并同一账号下仅大小写/空格不同的重名分类：
 *    保留最早创建的一条，其余分类下的链接全部挂到保留分类，再删除重复分类。
 * 合并后已超上限的老账号不做强制删除，只保证无法继续新增。
 */
function normalizeAndDedupeCategories(db) {
  const allCategories = db.prepare('SELECT id, user_id, name FROM categories ORDER BY id ASC').all();

  const updateName = db.prepare('UPDATE categories SET name = ? WHERE id = ?');
  const moveLinks = db.prepare('UPDATE links SET category_id = ? WHERE category_id = ?');
  const deleteCategory = db.prepare('DELETE FROM categories WHERE id = ?');

  // 第一步：就地规范化名称
  for (const cat of allCategories) {
    const normalized = normalizeCategoryName(cat.name);
    if (normalized && normalized !== cat.name) {
      updateName.run(normalized, cat.id);
      cat.name = normalized;
    }
  }

  // 第二步：按 (user_id, 比较键) 分组合并
  const groups = new Map();
  for (const cat of allCategories) {
    const key = categoryCompareKey(cat.name);
    if (!key) continue; // 异常的空白名称不参与合并
    const groupKey = `${cat.user_id}::${key}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(cat);
  }

  let mergedCount = 0;
  const mergeGroup = db.transaction((duplicates) => {
    // allCategories 按 id 升序，第一条即最早创建的分类，作为保留项
    const survivor = duplicates[0];
    for (const dup of duplicates.slice(1)) {
      moveLinks.run(survivor.id, dup.id);
      deleteCategory.run(dup.id);
      mergedCount += 1;
    }
  });

  for (const duplicates of groups.values()) {
    if (duplicates.length > 1) {
      mergeGroup(duplicates);
    }
  }

  if (mergedCount > 0) {
    console.log(`Merged ${mergedCount} duplicate categor${mergedCount === 1 ? 'y' : 'ies'}`);
  }
}

module.exports = { migrateDatabase };
