/**
 * 分类容量与命名的统一口径（服务端唯一事实来源）
 *
 * - 容量：同一账号最多 CATEGORY_LIMIT 个分类
 * - 命名：名称去除首尾空格、折叠中间连续空格后比较；
 *   比较时忽略大小写，因此 "Dev"、"dev"、" Dev  " 视为同一个分类
 */

const CATEGORY_LIMIT = 20;
const MAX_CATEGORY_NAME_LENGTH = 50;
const DEFAULT_CATEGORY_COLOR = '#409EFF';

/**
 * 用于展示与存储的名称：保留原始大小写，仅去掉首尾空格、
 * 把中间连续的空白（含 Tab/换行）折叠成一个空格。
 */
function cleanCategoryName(name) {
  if (name === null || name === undefined) return '';
  return String(name).replace(/\s+/g, ' ').trim();
}

/**
 * 用于查重的规范名称：忽略全部空格并转小写，
 * 因此 "My Links"、"mylinks"、" my  links " 都视为同名。
 */
function normalizeCategoryName(name) {
  if (name === null || name === undefined) return '';
  return String(name).replace(/\s+/g, '').toLowerCase();
}

/**
 * 仅接受 #RRGGBB 形式的颜色，其余情况回落到默认色，
 * 避免绕过页面直接提交时写入任意内容。
 */
function sanitizeCategoryColor(color) {
  if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color.trim())) {
    return color.trim();
  }
  return DEFAULT_CATEGORY_COLOR;
}

module.exports = {
  CATEGORY_LIMIT,
  MAX_CATEGORY_NAME_LENGTH,
  DEFAULT_CATEGORY_COLOR,
  cleanCategoryName,
  normalizeCategoryName,
  sanitizeCategoryColor,
};
