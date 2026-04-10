# Dev Notes

> 个人开发经验总结 · 技术笔记 · 项目复盘

基于 [VitePress](https://vitepress.dev/) 构建的个人技术笔记站。

## 📦 本地运行

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建静态站点
npm run build

# 预览构建产物
npm run preview
```

## 🚀 部署到 GitHub Pages

### 自动部署（推荐）

项目已配置 GitHub Actions 自动部署：

1. 将代码推送到 GitHub 仓库（仓库名建议为 `dev-notes`）
2. 进入仓库 Settings → Pages
3. Source 选择 **GitHub Actions**
4. 推送到 `main` 分支后会自动触发部署

部署完成后访问：`https://<你的用户名>.github.io/dev-notes/`

### 手动部署

```bash
npm run build
# 产物在 docs/.vitepress/dist 目录
```

## ⚙️ 配置说明

### 如果仓库名不是 `dev-notes`

修改 `docs/.vitepress/config.ts` 中的 `base` 配置：

```ts
export default defineConfig({
  base: '/你的仓库名/',
})
```

同时修改 `.github/workflows/deploy.yml` 不需要额外改动，它会自动读取构建产物。

### 如果要绑定自定义域名

1. 修改 `docs/.vitepress/config.ts` 中的 `base` 为 `'/'`：

```ts
export default defineConfig({
  base: '/',
})
```

2. 在 `docs/public/` 目录下创建 `CNAME` 文件，内容为你的域名：

```
your-domain.com
```

3. 在域名 DNS 中添加 CNAME 记录指向 `<你的用户名>.github.io`

## 📁 项目结构

```
my-page/
├── docs/
│   ├── .vitepress/
│   │   └── config.ts          # VitePress 配置
│   ├── public/
│   │   └── logo.svg           # 站点 Logo
│   ├── notes/
│   │   ├── frontend/          # 前端开发笔记
│   │   ├── ai/                # AI 学习笔记
│   │   ├── agent/             # Agent 开发笔记
│   │   ├── investment/        # 投资笔记
│   │   ├── engineering/       # 工程化笔记
│   │   ├── project-review/    # 项目复盘
│   │   └── snippets/          # 代码片段
│   ├── index.md               # 首页
│   └── about.md               # 关于我
├── .github/
│   └── workflows/
│       └── deploy.yml         # GitHub Actions 部署配置
├── package.json
├── .gitignore
└── README.md
```

## ✏️ 如何添加新文章

1. 在对应分类目录下创建 `.md` 文件
2. 在 `docs/.vitepress/config.ts` 的 `sidebar` 中添加对应条目
3. 推送到 `main` 分支即可自动部署

## 📝 文章模板

```markdown
# 文章标题

## 背景

（为什么写这篇文章）

## 问题

（要解决什么问题）

## 方案

（选择了什么方案，为什么）

## 实现

（关键实现细节）

## 收获

（学到了什么，下次怎么做得更好）
```

## 🔧 后续可扩展

- [ ] 添加 RSS 订阅
- [ ] 集成评论系统（Giscus）
- [ ] 添加文章标签和分类页
- [ ] 添加站点访问统计
- [ ] 支持全文搜索优化
- [ ] 添加暗色模式切换

## License

MIT
