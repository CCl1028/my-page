import { defineConfig } from 'vitepress'

export default defineConfig({
  // 站点基础配置
  title: 'Dev Notes',
  description: '个人技术笔记 · 项目展示',

  // GitHub Pages 部署路径
  base: '/dev-notes/',

  // 语言
  lang: 'zh-CN',

  // 最后更新时间
  lastUpdated: true,

  // 清理 URL（去掉 .html 后缀）
  cleanUrls: true,

  // Markdown 配置
  markdown: {
    lineNumbers: true,
  },

  // 主题配置
  themeConfig: {
    // Logo
    logo: '/logo.svg',
    siteTitle: 'Dev Notes',

    // 顶部导航 — 两大块：笔记 + 项目
    nav: [
      { text: '首页', link: '/' },
      {
        text: '笔记',
        items: [
          { text: '前端开发', link: '/notes/frontend/' },
          { text: 'AI 学习', link: '/notes/ai/' },
          { text: 'Agent 开发', link: '/notes/agent/' },
          { text: '投资笔记', link: '/notes/investment/' },
        ],
      },
      {
        text: '项目',
        items: [
          { text: 'FundPal 投资助手', link: '/projects/fundpal/' },
        ],
      },
      { text: '关于我', link: '/about' },
      { text: 'GitHub', link: 'https://github.com/your-username/dev-notes' },
    ],

    // 侧边栏
    sidebar: {
      // ========== 笔记 ==========
      '/notes/frontend/': [
        {
          text: '前端开发',
          items: [
            { text: '概览', link: '/notes/frontend/' },
            { text: 'Vue3 组合式 API 实践总结', link: '/notes/frontend/vue3-composition-api' },
            { text: 'TypeScript 在项目中的实战经验', link: '/notes/frontend/typescript-in-practice' },
          ],
        },
      ],
      '/notes/ai/': [
        {
          text: 'AI 学习',
          items: [
            { text: '概览', link: '/notes/ai/' },
            { text: 'Prompt Engineering 入门实践', link: '/notes/ai/prompt-engineering' },
          ],
        },
      ],
      '/notes/agent/': [
        {
          text: 'Agent 开发',
          items: [
            { text: '概览', link: '/notes/agent/' },
            { text: '从零搭建一个 AI Agent 的踩坑记录', link: '/notes/agent/build-ai-agent' },
          ],
        },
      ],
      '/notes/investment/': [
        {
          text: '投资笔记',
          items: [
            { text: '概览', link: '/notes/investment/' },
            { text: '我的投资体系搭建笔记', link: '/notes/investment/investment-system' },
          ],
        },
      ],

      // ========== 项目 ==========
      '/projects/fundpal/': [
        {
          text: 'FundPal 投资助手',
          items: [
            { text: '项目介绍', link: '/projects/fundpal/' },
            { text: '功能特性', link: '/projects/fundpal/features' },
            { text: '技术架构', link: '/projects/fundpal/architecture' },
            { text: '开发历程', link: '/projects/fundpal/devlog' },
          ],
        },
      ],
    },

    // 社交链接
    socialLinks: [
      { icon: 'github', link: 'https://github.com/your-username' },
    ],

    // 页脚
    footer: {
      message: '用 VitePress 构建 · 持续记录，持续成长',
      copyright: '© 2024-present',
    },

    // 搜索
    search: {
      provider: 'local',
    },

    // 编辑链接
    editLink: {
      pattern: 'https://github.com/CCl1028/dev-notes/edit/main/docs/:path',
      text: '在 GitHub 上编辑此页',
    },

    // 最后更新时间文本
    lastUpdated: {
      text: '最后更新于',
    },

    // 文档页脚导航文本
    docFooter: {
      prev: '上一篇',
      next: '下一篇',
    },

    // 大纲标题
    outline: {
      label: '目录',
      level: [2, 3],
    },

    // 返回顶部文本
    returnToTopLabel: '返回顶部',
  },
})
