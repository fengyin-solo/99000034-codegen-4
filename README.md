# Link Collector - 书签收藏管理工具

一个轻量级的书签/链接收藏管理工具，支持分类管理、标签筛选、搜索、浏览器书签导入和死链检测功能。

## 功能特性

- **链接 CRUD**: 添加、编辑、删除链接，支持 URL、标题、描述、标签和分类
- **浏览与搜索**: 分类侧边栏、标签云筛选、文本搜索、分页展示
- **分类容量与命名口径**: 每个账号最多 20 个分类；名称忽略大小写与空格判重，重复时自动合并；删除分类后其下链接回到「未分类」
- **导入浏览器书签**: 上传 Chrome 书签 HTML 文件，解析并批量导入
- **死链检测**: 检测所有保存链接的 HTTP 状态，展示失效链接
- **用户认证**: 基于 JWT + bcrypt 的注册/登录系统

## 技术栈

### 前端
- Vue 3 + Vite
- Vue Router
- Pinia (状态管理)
- Element Plus (UI 组件库)
- Axios (HTTP 客户端)

### 后端
- Node.js + Express
- better-sqlite3 (SQLite 数据库)
- jsonwebtoken (JWT 认证)
- bcryptjs (密码加密)
- multer (文件上传)

## 快速开始

### 环境要求

- Node.js 18+ (需要原生 fetch 支持)
- npm 或 yarn

### 安装

1. 克隆或进入项目目录：

```bash
cd link-collector
```

2. 安装后端依赖：

```bash
cd backend
npm install
```

3. 初始化数据库并添加示例数据：

```bash
npm run seed
```

4. 安装前端依赖：

```bash
cd ../frontend
npm install
```

### 运行

1. 启动后端服务器 (端口 3004)：

```bash
cd backend
npm run dev
```

2. 启动前端开发服务器 (端口 5176)：

```bash
cd frontend
npm run dev
```

3. 打开浏览器访问：http://localhost:5176

### 测试

分类容量与命名口径的端到端测试（使用独立临时数据库，不影响示例数据）：

```bash
cd backend
npm test
```

### 演示账号

- 用户名: `demo`
- 密码: `demo123`

## 项目结构

```
link-collector/
├── frontend/                 # 前端项目
│   ├── src/
│   │   ├── api/             # API 请求封装
│   │   ├── components/      # Vue 组件
│   │   ├── router/          # 路由配置
│   │   ├── stores/          # Pinia 状态管理
│   │   ├── views/           # 页面视图
│   │   ├── App.vue
│   │   └── main.js
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── backend/                  # 后端项目
│   ├── db/
│   │   ├── init.js          # 数据库初始化
│   │   └── seed.js          # 示例数据
│   ├── middleware/
│   │   └── auth.js          # JWT 认证中间件
│   ├── routes/
│   │   ├── auth.js          # 认证路由
│   │   ├── links.js         # 链接路由
│   │   ├── categories.js    # 分类路由
│   │   ├── import.js        # 导入路由
│   │   └── health-check.js  # 死链检测路由
│   ├── utils/
│   │   ├── bookmark-parser.js  # 书签解析器
│   │   └── link-checker.js     # 链接检测器
│   ├── data/                # SQLite 数据库文件
│   ├── server.js
│   └── package.json
└── README.md
```

## API 接口

### 认证
- `POST /api/auth/register` - 用户注册
- `POST /api/auth/login` - 用户登录

### 链接
- `GET /api/links` - 获取链接列表 (支持分页、分类、标签、搜索筛选)
- `POST /api/links` - 创建链接
- `PUT /api/links/:id` - 更新链接
- `DELETE /api/links/:id` - 删除链接

### 分类
- `GET /api/categories` - 获取用户分类列表
- `GET /api/categories/quota` - 获取分类容量使用情况（count 已有 / limit 上限 / remaining 剩余 / over_limit 是否为超限老账号）
- `POST /api/categories` - 创建分类；名称与已有分类仅大小写或空格不同时返回该分类并带 `merged: true`，达到上限返回 `409`
- `PUT /api/categories/:id` - 更新分类；改名后与已有分类同名时合并（其下链接一并并入）
- `DELETE /api/categories/:id` - 删除分类，其下链接的 `category_id` 置空（回到未分类）

### 分类容量与命名规则

- **容量上限**：每个账号最多 20 个分类（`backend/utils/categoryPolicy.js` 中的 `CATEGORY_LIMIT`）。达到上限后无法新增，接口返回 `409` 并附带当前数量与上限，前端侧栏显示「已建 N/20」并禁用新增按钮。
- **重名合并**：判重时忽略大小写和所有空格（`My Links`、`mylinks`、` my  links ` 视为同名）。新建/编辑撞名时不报错，而是合并到已有分类，链接归入该分类。
- **删除行为**：删除分类不会删除链接，其下链接自动回到「未分类」，列表与侧栏不会残留失效标签。
- **服务端强制**：上限与重名判定都在服务端完成，数据库层还有 `(user_id, name_key)` 唯一索引兜底；绕过页面直接提交同样会被拦截。链接也不能挂到别人名下或已删除的分类。
- **超限老账号**：历史原因导致超过 20 个分类的账号仍可正常查看、整理和删除；只有「新增」会被拦截，删除后计数实时刷新，回落到上限以下即可继续新建。
- **书签导入**：同名文件夹复用已有分类；已满额时无法为新文件夹建类，其中的书签作为「未分类」导入，并在结果中给出 `uncategorized_by_limit` 计数。

### 标签
- `GET /api/tags` - 获取用户所有标签 (带计数)

### 导入
- `POST /api/import/bookmarks` - 导入 Chrome 书签

### 死链检测
- `POST /api/health-check/all` - 检测所有链接
- `GET /api/health-check/dead` - 获取失效链接列表

## 数据库表结构

- **users**: 用户表 (id, username, email, password, created_at)
- **categories**: 分类表 (id, user_id, name, name_key, color)，`(user_id, name_key)` 唯一，name_key 为忽略大小写与空格的规范名
- **links**: 链接表 (id, user_id, url, title, description, category_id, status, last_checked, created_at)
- **link_tags**: 标签关联表 (id, link_id, tag)

## 导入 Chrome 书签

1. 在 Chrome 浏览器中导出书签为 HTML 文件
2. 进入 "导入书签" 页面
3. 上传 HTML 文件
4. 系统会自动解析并导入链接，同时根据文件夹创建分类

## License

MIT
