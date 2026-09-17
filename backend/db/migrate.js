const Database = require('better-sqlite3');
const path = require('path');
const { cleanCategoryName, normalizeCategoryName } = require('../utils/categoryPolicy');

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '..', 'data', 'links.db');

function migrateDatabase() {
  const db = new Database(DB_PATH);

  try {
    const tableInfo = db.pragma("table_info(links)");
    const columns = tableInfo.map(col => col.name);

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

    migrateCategoryNameKey(db);

    console.log('Database migration completed successfully');
  } catch (error) {
    console.error('Migration error:', error);
  } finally {
    db.close();
  }
}

/**
 * 分类命名口径迁移：
 * 1. 增加 name_key（规范名：去空格折叠 + 小写）
 * 2. 清理存量名称（首尾/多余空格），回填 name_key
 * 3. 同一账号下 name_key 相同的分类合并为一个，链接并入保留的分类
 * 4. 建立 (user_id, name_key) 唯一索引，在数据库层兜底防重
 */
function migrateCategoryNameKey(db) {
  const catColumns = db.pragma('table_info(categories)').map((col) => col.name);

  if (!catColumns.includes('name_key')) {
    db.exec('ALTER TABLE categories ADD COLUMN name_key TEXT');
    console.log('Added column: categories.name_key');
  }

  const allCategories = db.prepare('SELECT id, user_id, name FROM categories').all();

  // 回填规范名，并顺手清理存量名称中的多余空格
  const updateName = db.prepare('UPDATE categories SET name = ?, name_key = ? WHERE id = ?');
  const groups = new Map();
  for (const cat of allCategories) {
    const clean = cleanCategoryName(cat.name);
    const key = normalizeCategoryName(cat.name);
    updateName.run(clean, key, cat.id);
    const groupKey = `${cat.user_id}::${key}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push({ ...cat, name: clean, name_key: key });
  }

  // 合并同名（仅大小写/空格不同）分类：保留最早创建的一条
  const repointLinks = db.prepare(
    'UPDATE links SET category_id = ? WHERE category_id = ?'
  );
  const deleteCategory = db.prepare('DELETE FROM categories WHERE id = ?');
  const mergeDuplicates = db.transaction((duplicates) => {
    for (const group of duplicates) {
      const [keeper, ...others] = group.sort((a, b) => a.id - b.id);
      for (const other of others) {
        repointLinks.run(keeper.id, other.id);
        deleteCategory.run(other.id);
        console.log(
          `Merged category "${other.name}" (id=${other.id}) into "${keeper.name}" (id=${keeper.id})`
        );
      }
    }
  });

  const duplicateGroups = [...groups.values()].filter((g) => g.length > 1);
  if (duplicateGroups.length > 0) {
    mergeDuplicates(duplicateGroups);
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_user_name_key
      ON categories(user_id, name_key)
  `);
}

module.exports = { migrateDatabase };
