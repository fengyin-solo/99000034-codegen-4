/**
 * 分类容量与命名口径的端到端测试（使用独立临时数据库）。
 * 运行：node test/category.policy.test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-test-'));
const TMP_DB = path.join(TMP_DIR, 'test.db');
process.env.DB_PATH = TMP_DB;

const { initDatabase } = require('../db/init');
const { migrateDatabase } = require('../db/migrate');
initDatabase();
migrateDatabase();

const app = require('../server');
const { CATEGORY_LIMIT } = require('../utils/categoryPolicy');

let server;
let base;
let token;
let otherToken;

async function api(method, urlPath, body, tok) {
  const res = await fetch(base + urlPath, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  const text = await res.text();
  if (text) data = JSON.parse(text);
  return { status: res.status, data };
}

async function register(name) {
  const r = await api('POST', '/api/auth/register', {
    username: name,
    email: `${name}@test.com`,
    password: 'secret123',
  });
  return r.data.token;
}

let passed = 0;
function test(name, fn) {
  return fn().then(() => {
    passed++;
    console.log(`  ✓ ${name}`);
  });
}

async function main() {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  token = await register('alice');
  otherToken = await register('bob');

  // 1. 未带 token 直接提交要被拦下
  await test('未认证创建分类 -> 401', async () => {
    const r = await api('POST', '/api/categories', { name: 'x' });
    assert.strictEqual(r.status, 401);
  });

  // 2. 基本创建 + 配额计数
  let firstId;
  await test('创建首个分类，quota 计数正确', async () => {
    const r = await api('POST', '/api/categories', { name: '工作' }, token);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.merged, false);
    firstId = r.data.id;
    const q = await api('GET', '/api/categories/quota', null, token);
    assert.strictEqual(q.data.count, 1);
    assert.strictEqual(q.data.limit, CATEGORY_LIMIT);
    assert.strictEqual(q.data.remaining, CATEGORY_LIMIT - 1);
  });

  // 3. 大小写/空格差异 -> 合并到已有分类
  await test('" 工 作 " 与 "工作" 视为同名，不再新建', async () => {
    const r = await api('POST', '/api/categories', { name: '  工  作 ' }, token);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.merged, true);
    assert.strictEqual(r.data.id, firstId);
    assert.strictEqual(r.data.name, '工作'); // 保留已有名称
    const q = await api('GET', '/api/categories/quota', null, token);
    assert.strictEqual(q.data.count, 1);
  });

  await test('大小写不同 "JOB" 并入已有（此处与工作不同名，新建）再 "job" 合并', async () => {
    const created = await api('POST', '/api/categories', { name: 'JOB' }, token);
    assert.strictEqual(created.data.merged, false);
    const merged = await api('POST', '/api/categories', { name: 'job' }, token);
    assert.strictEqual(merged.data.merged, true);
    assert.strictEqual(merged.data.id, created.data.id);
    assert.strictEqual(merged.data.name, 'JOB');
    const list = await api('GET', '/api/categories', null, token);
    assert.strictEqual(list.data.length, 2);
  });

  // 4. 空名称 / 超长 / 非法颜色
  await test('空白名称 -> 400', async () => {
    const r = await api('POST', '/api/categories', { name: '   ' }, token);
    assert.strictEqual(r.status, 400);
  });
  await test('非法颜色被净化为默认色', async () => {
    const r = await api('POST', '/api/categories', { name: '彩色', color: 'not-a-color' }, token);
    assert.strictEqual(r.data.color, '#409EFF');
  });

  // 5. 灌到上限，第 limit+1 个被拒并带 count/limit
  await test('达到上限后新增 -> 409 且说明当前数量', async () => {
    // 已有：工作、JOB、彩色 = 3
    for (let i = 3; i < CATEGORY_LIMIT; i++) {
      const r = await api('POST', '/api/categories', { name: `分类${i}` }, token);
      assert.strictEqual(r.status, 200, `分类${i} 应创建成功`);
    }
    const q1 = await api('GET', '/api/categories/quota', null, token);
    assert.strictEqual(q1.data.count, CATEGORY_LIMIT);
    assert.strictEqual(q1.data.remaining, 0);

    const blocked = await api('POST', '/api/categories', { name: '超出的' }, token);
    assert.strictEqual(blocked.status, 409);
    assert.strictEqual(blocked.data.code, 'CATEGORY_LIMIT_REACHED');
    assert.strictEqual(blocked.data.count, CATEGORY_LIMIT);
    assert.ok(/20\/20/.test(blocked.data.error), '错误信息应包含当前/上限数量');
    // 计数不增长
    const q2 = await api('GET', '/api/categories/quota', null, token);
    assert.strictEqual(q2.data.count, CATEGORY_LIMIT);
  });

  // 6. 上限后重名仍然合并（不占名额）
  await test('满额时提交已有分类的别名 -> 仍合并成功', async () => {
    const r = await api('POST', '/api/categories', { name: ' 工  作 ' }, token);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.merged, true);
  });

  // 7. 删除分类：链接回到未分类，计数-1，列表无残留
  let linkId;
  await test('删除分类后其下链接回到未分类，侧栏计数刷新', async () => {
    // 建一个链接挂到“工作”
    const link = await api('POST', '/api/links', {
      url: 'https://example.com/a',
      title: 'A',
      category_id: firstId,
    }, token);
    linkId = link.data.id;
    assert.strictEqual(link.data.category_id, firstId);
    assert.strictEqual(link.data.category_name, '工作');

    const del = await api('DELETE', `/api/categories/${firstId}`, null, token);
    assert.strictEqual(del.status, 200);
    assert.strictEqual(del.data.moved_links, 1);
    assert.strictEqual(del.data.count, CATEGORY_LIMIT - 1);

    const linkAfter = await api('GET', `/api/links?page=1&limit=50`, null, token);
    const found = linkAfter.data.links.find((l) => l.id === linkId);
    assert.strictEqual(found.category_id, null);
    assert.strictEqual(found.category_name, null);

    const cats = await api('GET', '/api/categories', null, token);
    assert.strictEqual(cats.data.find((c) => c.id === firstId), undefined);
    // 释放出一个名额
    const q = await api('GET', '/api/categories/quota', null, token);
    assert.strictEqual(q.data.remaining, 1);
  });

  // 8. 删除后可再新建
  await test('腾出位置后可新增', async () => {
    const r = await api('POST', '/api/categories', { name: '新分类' }, token);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.merged, false);
  });

  // 9. PUT 重命名撞到已有别名 -> 合并并迁移链接
  await test('编辑成已有分类的大小写别名 -> 合并，链接并入目标', async () => {
    // 当前账号已满额，先腾出 2 个名额
    let list = (await api('GET', '/api/categories', null, token)).data;
    const spare = list.filter((c) => !['工作', 'JOB', '彩色'].includes(c.name)).slice(0, 2);
    for (const c of spare) {
      await api('DELETE', `/api/categories/${c.id}`, null, token);
    }

    const a = await api('POST', '/api/categories', { name: 'Alpha' }, token);
    const b = await api('POST', '/api/categories', { name: 'Beta' }, token);
    assert.strictEqual(a.status, 200);
    assert.strictEqual(b.status, 200);
    // Alpha 下挂一个链接
    await api('POST', '/api/links', { url: 'https://example.com/alpha', title: 'AL', category_id: a.data.id }, token);
    // Beta 下也挂一个链接，合并后应并入 Alpha
    await api('POST', '/api/links', { url: 'https://example.com/beta', title: 'BE', category_id: b.data.id }, token);
    // Beta 改名成 "alpha"（大小写差异）
    const r = await api('PUT', `/api/categories/${b.data.id}`, { name: 'alpha' }, token);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.merged, true);
    assert.strictEqual(r.data.id, a.data.id);
    // 两个分类下的链接都在 Alpha
    const links = await api('GET', '/api/links?page=1&limit=50', null, token);
    for (const u of ['https://example.com/alpha', 'https://example.com/beta']) {
      const found = links.data.links.find((l) => l.url === u);
      assert.strictEqual(found.category_id, a.data.id, `${u} 应并入 Alpha`);
    }
    const cats = await api('GET', '/api/categories', null, token);
    assert.strictEqual(cats.data.find((c) => c.id === b.data.id), undefined);
  });

  // 10. 链接不能挂到别人的分类 / 不存在的分类（绕过页面直提）
  await test('链接挂到他人分类 -> 400', async () => {
    const other = await api('POST', '/api/categories', { name: '别人的分类' }, otherToken);
    const r = await api('POST', '/api/links', {
      url: 'https://evil.example.com', title: 'E', category_id: other.data.id,
    }, token);
    assert.strictEqual(r.status, 400);
  });
  await test('链接挂到不存在的分类 -> 400', async () => {
    const r = await api('POST', '/api/links', {
      url: 'https://ghost.example.com', title: 'G', category_id: 999999,
    }, token);
    assert.strictEqual(r.status, 400);
  });
  await test('更新链接到已删除分类 -> 400', async () => {
    const r = await api('PUT', `/api/links/${linkId}`, { category_id: 999999 }, token);
    assert.strictEqual(r.status, 400);
  });

  // 11. 数据库层唯一索引兜底（绕过 HTTP 直接插）
  await test('DB 唯一索引阻止同规范名重复', async () => {
    const { getDb } = require('../db/init');
    const db = getDb();
    db.prepare("INSERT INTO categories (user_id, name, name_key, color) VALUES (?, ?, ?, ?)").run(2, 'X', 'x', '#000000');
    assert.throws(() => {
      db.prepare("INSERT INTO categories (user_id, name, name_key, color) VALUES (?, ?, ?, ?)").run(2, 'x', 'x', '#000000');
    }, /UNIQUE/i);
  });

  // 12. 导入书签：重名文件夹复用分类；满额时链接落未分类
  await test('导入时同名文件夹复用、满额文件夹回落未分类', async () => {
    // bob 当前 1 个分类（“别人的分类”），把他灌到上限
    for (let i = 1; i < CATEGORY_LIMIT; i++) {
      await api('POST', '/api/categories', { name: `b文件夹${i}` }, otherToken);
    }
    const html = [
      '<DL><p>',
      '  <DT><H3>别人的分类</H3>',
      '  <DL><p>',
      '    <DT><A HREF="https://b1.example.com">B1</A>',
      '  </DL><p>',
      '  <DT><H3>全新文件夹</H3>',
      '  <DL><p>',
      '    <DT><A HREF="https://b2.example.com">B2</A>',
      '  </DL><p>',
      '  <DT><A HREF="https://b3.example.com">B3</A>',
      '</DL>',
    ].join('\n');

    const boundary = '----testboundary123';
    const reqBody = '\r\n' + [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="bookmarks.html"',
      'Content-Type: text/html',
      '',
      html,
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const res = await fetch(base + '/api/import/bookmarks', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${otherToken}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: reqBody,
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.imported, 3);
    assert.strictEqual(data.uncategorized_by_limit, 1, '“全新文件夹”里的 1 条应回落未分类');

    const { getDb } = require('../db/init');
    const db = getDb();
    const bobId = db.prepare("SELECT id FROM users WHERE username='bob'").get().id;
    const b1 = db.prepare("SELECT category_id FROM links WHERE url='https://b1.example.com'").get();
    const b2 = db.prepare("SELECT category_id FROM links WHERE url='https://b2.example.com'").get();
    const b3 = db.prepare("SELECT category_id FROM links WHERE url='https://b3.example.com'").get();
    const reused = db.prepare('SELECT id FROM categories WHERE user_id=? AND name_key=?').get(bobId, '别人的分类');
    assert.ok(reused, '“别人的分类”应被复用而非新建');
    assert.strictEqual(b1.category_id, reused.id, 'B1 应挂到复用的分类');
    assert.strictEqual(b2.category_id, null, 'B2 应在未分类');
    assert.strictEqual(b3.category_id, null, '根级书签 B3 应在未分类');
    assert.strictEqual(
      db.prepare('SELECT COUNT(*) n FROM categories WHERE user_id=?').get(bobId).n,
      CATEGORY_LIMIT,
      '导入不应使分类数超过上限'
    );
  });

  // 13. 超限老账号：直接往 DB 塞分类造成超限，仍可查看/整理/删除
  await test('已经超过上限的老账号仍可查看与整理，且不能继续新增', async () => {
    const { getDb } = require('../db/init');
    const db = getDb();
    const bobId = db.prepare("SELECT id FROM users WHERE username='bob'").get().id;
    // 直接绕过后端塞入第 21、22 个分类，模拟历史超限账号
    db.prepare("INSERT INTO categories (user_id, name, name_key, color) VALUES (?, ?, ?, ?)")
      .run(bobId, '遗留1', '遗留1', '#111111');
    db.prepare("INSERT INTO categories (user_id, name, name_key, color) VALUES (?, ?, ?, ?)")
      .run(bobId, '遗留2', '遗留2', '#222222');

    const q = await api('GET', '/api/categories/quota', null, otherToken);
    assert.strictEqual(q.data.over_limit, true);
    assert.ok(q.data.count > CATEGORY_LIMIT);

    // 仍可查看列表和链接
    const cats = await api('GET', '/api/categories', null, otherToken);
    assert.ok(cats.data.length > CATEGORY_LIMIT);
    const links = await api('GET', '/api/links', null, otherToken);
    assert.strictEqual(links.status, 200);

    // 仍可整理：删一个链接、编辑链接
    if (links.data.links[0]) {
      const lid = links.data.links[0].id;
      const del = await api('DELETE', `/api/links/${lid}`, null, otherToken);
      assert.strictEqual(del.status, 200);
    }

    // 仍可删除分类（数据不受影响），删除后计数跟着变
    const legacy = cats.data.find((c) => c.name === '遗留1');
    const delCat = await api('DELETE', `/api/categories/${legacy.id}`, null, otherToken);
    assert.strictEqual(delCat.status, 200);

    // 超限状态下仍禁止新增，直到回到上限以下
    const blocked = await api('POST', '/api/categories', { name: '再试一个' }, otherToken);
    assert.strictEqual(blocked.status, 409);
  });

  console.log(`\n全部通过：${passed} 项`);
  server.close();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  process.exit(0);
}

main().catch((err) => {
  console.error('测试失败：', err);
  try { server.close(); } catch {}
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  process.exit(1);
});
