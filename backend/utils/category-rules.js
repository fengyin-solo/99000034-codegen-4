// 分类容量与命名的统一口径（服务端唯一可信来源）

// 每个账号最多可拥有的分类数量
const CATEGORY_LIMIT = 20;

// 分类名称的最大长度
const CATEGORY_NAME_MAX_LENGTH = 50;

/**
 * 规范化分类名称：
 * 1. 去除首尾空白
 * 2. 将连续的空白字符（含全角空格、制表符等）折叠为单个半角空格
 *
 * 注意：这里不做大小写折叠，原始名称保留用户输入的大小写展示；
 * 重名比较时使用 compareKey 做大小写不敏感匹配。
 */
function normalizeCategoryName(name) {
  if (name === null || name === undefined) return '';
  return String(name).replace(/\s+/g, ' ').trim();
}

/**
 * 生成重名比较用的 key：
 * 规范化后统一转小写，使 "Tech"、" tech "、"TECH  " 视为同一个分类。
 */
function categoryCompareKey(name) {
  return normalizeCategoryName(name).toLowerCase();
}

module.exports = {
  CATEGORY_LIMIT,
  CATEGORY_NAME_MAX_LENGTH,
  normalizeCategoryName,
  categoryCompareKey,
};
