const bcrypt = require('bcryptjs');
const { initDatabase, getDb } = require('./init');
const { normalizeCategoryName } = require('../utils/categoryPolicy');

function seed() {
  initDatabase();
  const db = getDb();

  // Check if data already exists
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (userCount.count > 0) {
    console.log('Database already has data, skipping seed.');
    return;
  }

  // Create demo user
  const hashedPassword = bcrypt.hashSync('demo123', 10);
  const insertUser = db.prepare(
    'INSERT INTO users (username, email, password) VALUES (?, ?, ?)'
  );
  insertUser.run('demo', 'demo@example.com', hashedPassword);
  const userId = 1;

  // Create categories
  const insertCategory = db.prepare(
    'INSERT INTO categories (user_id, name, name_key, color) VALUES (?, ?, ?, ?)'
  );

  const categories = [
    { name: 'Development', color: '#409EFF' },
    { name: 'Design', color: '#67C23A' },
    { name: 'News', color: '#E6A23C' },
    { name: 'Tools', color: '#F56C6C' },
    { name: 'Learning', color: '#909399' },
    { name: 'Entertainment', color: '#9B59B6' },
  ];

  const categoryIds = {};
  categories.forEach((cat) => {
    const result = insertCategory.run(userId, cat.name, normalizeCategoryName(cat.name), cat.color);
    categoryIds[cat.name] = result.lastInsertRowid;
  });

  // Create links
  const insertLink = db.prepare(
    'INSERT INTO links (user_id, url, title, description, category_id, status) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertTag = db.prepare(
    'INSERT INTO link_tags (link_id, tag) VALUES (?, ?)'
  );

  const links = [
    {
      url: 'https://developer.mozilla.org/zh-CN/',
      title: 'MDN Web Docs',
      description: 'Mozilla 开发者网络，前端开发必备文档站点',
      category: 'Development',
      tags: ['前端', '文档', '教程'],
    },
    {
      url: 'https://vuejs.org/',
      title: 'Vue.js 官网',
      description: '渐进式 JavaScript 框架，易学易用的高性能前端框架',
      category: 'Development',
      tags: ['前端', 'Vue', '框架'],
    },
    {
      url: 'https://react.dev/',
      title: 'React 官方文档',
      description: '用于构建用户界面的 JavaScript 库，由 Meta 维护',
      category: 'Development',
      tags: ['前端', 'React', '框架'],
    },
    {
      url: 'https://nodejs.org/',
      title: 'Node.js',
      description: '基于 Chrome V8 引擎的 JavaScript 运行时环境',
      category: 'Development',
      tags: ['后端', 'Node.js', 'JavaScript'],
    },
    {
      url: 'https://expressjs.com/',
      title: 'Express.js',
      description: '快速、无约束、极简的 Node.js Web 框架',
      category: 'Development',
      tags: ['后端', 'Node.js', '框架'],
    },
    {
      url: 'https://www.figma.com/',
      title: 'Figma',
      description: '协作式界面设计工具，支持实时多人协作',
      category: 'Design',
      tags: ['UI', '设计', '协作'],
    },
    {
      url: 'https://dribbble.com/',
      title: 'Dribbble',
      description: '设计师社区，展示优秀设计作品和创意灵感',
      category: 'Design',
      tags: ['UI', '设计', '灵感'],
    },
    {
      url: 'https://www.behance.net/',
      title: 'Behance',
      description: 'Adobe 旗下创意作品展示平台，汇聚全球优秀设计师',
      category: 'Design',
      tags: ['UI', '设计', '作品集'],
    },
    {
      url: 'https://news.ycombinator.com/',
      title: 'Hacker News',
      description: 'Y Combinator 运营的科技新闻社区，高质量技术讨论',
      category: 'News',
      tags: ['新闻', '科技', '社区'],
    },
    {
      url: 'https://www.36kr.com/',
      title: '36氪',
      description: '中国领先的商业科技媒体平台，关注创业和创新',
      category: 'News',
      tags: ['新闻', '科技', '创业'],
    },
    {
      url: 'https://juejin.cn/',
      title: '掘金',
      description: '面向开发者的技术社区，分享技术文章和学习资源',
      category: 'News',
      tags: ['新闻', '技术', '社区'],
    },
    {
      url: 'https://github.com/',
      title: 'GitHub',
      description: '全球最大的代码托管平台，开源项目的家园',
      category: 'Tools',
      tags: ['工具', 'Git', '开源'],
    },
    {
      url: 'https://www.notion.so/',
      title: 'Notion',
      description: '多功能笔记和协作工具，集文档、数据库、看板于一体',
      category: 'Tools',
      tags: ['工具', '笔记', '协作'],
    },
    {
      url: 'https://www.postman.com/',
      title: 'Postman',
      description: 'API 开发和测试工具，支持接口调试和自动化测试',
      category: 'Tools',
      tags: ['工具', 'API', '测试'],
    },
    {
      url: 'https://vercel.com/',
      title: 'Vercel',
      description: '前端项目部署平台，支持 Next.js 等多种框架',
      category: 'Tools',
      tags: ['工具', '部署', '前端'],
    },
    {
      url: 'https://leetcode.cn/',
      title: '力扣 LeetCode',
      description: '算法刷题平台，帮助提升编程和算法能力',
      category: 'Learning',
      tags: ['教程', '算法', '刷题'],
    },
    {
      url: 'https://www.freecodecamp.org/',
      title: 'freeCodeCamp',
      description: '免费学习编程的平台，提供完整的全栈开发课程',
      category: 'Learning',
      tags: ['教程', '免费', '全栈'],
    },
    {
      url: 'https://www.bilibili.com/',
      title: '哔哩哔哩',
      description: '中国年轻人的视频社区，有大量技术教程视频',
      category: 'Entertainment',
      tags: ['视频', '学习', '娱乐'],
    },
    {
      url: 'https://www.youtube.com/',
      title: 'YouTube',
      description: '全球最大视频平台，丰富的编程教程和技术分享',
      category: 'Entertainment',
      tags: ['视频', '学习', '娱乐'],
    },
    {
      url: 'https://sspai.com/',
      title: '少数派',
      description: '高质量数字生活指南，分享效率工具和数码评测',
      category: 'Entertainment',
      tags: ['新闻', '效率', '工具'],
    },
    {
      url: 'https://typescript.bootcss.com/',
      title: 'TypeScript 中文文档',
      description: 'TypeScript 编程语言中文文档，JavaScript 的超集',
      category: 'Development',
      tags: ['前端', 'TypeScript', '文档'],
    },
    {
      url: 'https://tailwindcss.com/',
      title: 'Tailwind CSS',
      description: '实用优先的 CSS 框架，快速构建现代网页界面',
      category: 'Development',
      tags: ['前端', 'CSS', '框架'],
    },
  ];

  const insertLinkWithTags = db.transaction((linkData) => {
    const result = insertLink.run(
      userId,
      linkData.url,
      linkData.title,
      linkData.description,
      categoryIds[linkData.category],
      'unchecked'
    );
    const linkId = result.lastInsertRowid;
    linkData.tags.forEach((tag) => {
      insertTag.run(linkId, tag);
    });
  });

  links.forEach((link) => {
    insertLinkWithTags(link);
  });

  console.log('Seed data created successfully!');
  console.log('- 1 demo user (demo/demo123)');
  console.log(`- ${categories.length} categories`);
  console.log(`- ${links.length} links with tags`);
}

seed();
