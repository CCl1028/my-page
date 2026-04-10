# 技术架构

FundPal 采用前后端分离架构，追求**简洁、可维护、可扩展**。

## 🏗 整体架构

```
┌─────────────────────────────────────────────────┐
│                   Frontend                       │
│  Vue 3 + TypeScript + Vite + TailwindCSS         │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │  Views   │ │Components│ │   Composables    │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
│                     │                            │
│              ┌──────┴──────┐                     │
│              │  API Layer  │                     │
│              └──────┬──────┘                     │
└─────────────────────┼───────────────────────────┘
                      │ HTTP / WebSocket
┌─────────────────────┼───────────────────────────┐
│                   Backend                        │
│  Node.js + Express + TypeScript                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │  Routes  │ │ Services │ │   Data Sources   │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
│                     │                            │
│         ┌───────────┼───────────┐                │
│         │           │           │                │
│    ┌────┴───┐  ┌────┴───┐  ┌───┴────┐           │
│    │ SQLite │  │  API   │  │   AI   │           │
│    │  (DB)  │  │ (行情) │  │(OpenAI)│           │
│    └────────┘  └────────┘  └────────┘           │
└─────────────────────────────────────────────────┘
```

## 🎨 前端架构

### 技术选型

| 技术 | 选择 | 原因 |
|------|------|------|
| 框架 | Vue 3 | 组合式 API 好用，生态完善 |
| 语言 | TypeScript | 类型安全，重构有信心 |
| 构建 | Vite | 快，开发体验好 |
| 样式 | TailwindCSS | 原子化 CSS，开发效率高 |
| 图表 | ECharts | 金融图表支持最好 |
| 状态 | Pinia | 轻量，TS 支持好 |
| 路由 | Vue Router | 官方方案 |

### 目录结构

```
src/
├── views/              # 页面组件
│   ├── Dashboard/      # 看板
│   ├── Fund/           # 基金筛选
│   ├── Portfolio/      # 组合管理
│   └── Strategy/       # 定投策略
├── components/         # 通用组件
│   ├── charts/         # 图表组件
│   └── ui/             # UI 基础组件
├── composables/        # 组合式函数
│   ├── useFund.ts
│   ├── usePortfolio.ts
│   └── useMarket.ts
├── stores/             # Pinia 状态
├── api/                # API 请求层
├── utils/              # 工具函数
└── types/              # TypeScript 类型定义
```

## ⚙️ 后端架构

### 服务分层

```typescript
// Routes → Services → Data Sources 三层架构

// 1. 路由层：处理 HTTP 请求
router.get('/api/fund/:code', fundController.getFundDetail)

// 2. 服务层：业务逻辑
class FundService {
  async getFundDetail(code: string) {
    const basic = await this.dataSource.getFundBasic(code)
    const nav = await this.dataSource.getFundNav(code)
    return this.transform(basic, nav)
  }
}

// 3. 数据层：数据获取与缓存
class FundDataSource {
  async getFundBasic(code: string) {
    // 先查缓存 → 再查数据库 → 最后请求外部 API
  }
}
```

### 数据缓存策略

- **L1 内存缓存**：热点数据（当日行情），TTL 5 分钟
- **L2 SQLite 缓存**：历史数据（净值、持仓），按天更新
- **L3 外部 API**：实时数据兜底，做好限流和降级

## 🤖 AI 模块设计

```typescript
// AI 分析模块采用插件式设计
interface AnalysisPlugin {
  name: string
  analyze(fund: FundData): Promise<AnalysisResult>
}

// 可以灵活切换模型
const plugins: AnalysisPlugin[] = [
  new OpenAIAnalysis(),      // OpenAI GPT
  new LocalModelAnalysis(),  // 本地模型（ollama）
]
```

## 📦 部署方案

- **开发环境**：本地 SQLite + Vite Dev Server
- **生产环境**：Docker Compose 一键部署
- **数据库**：支持 SQLite（个人使用）或 PostgreSQL（多人使用）

---

> 架构不是一开始就设计完美的，而是随着需求演进不断优化的。
