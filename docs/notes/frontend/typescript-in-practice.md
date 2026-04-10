# TypeScript 在项目中的实战经验

## 背景

团队引入 TypeScript 已经一年多了。从最初的「加个 any 就完事」到现在能比较熟练地用好类型系统，踩了不少坑，也积累了一些真正有用的实践经验。

这篇文章不讲类型体操，只记录**在实际项目中真正帮到我的 TypeScript 用法**。

## 问题

刚开始用 TypeScript 时常见的几个问题：

1. 到处写 `any`，TS 形同虚设
2. 接口返回值类型不明确，调用方不敢信
3. 组件 Props 类型不够严格，bug 到运行时才发现
4. 联合类型和类型收窄用不好，写出一堆 `as` 强转

## 方案

以下是项目中沉淀下来的几个实践模式。

## 实现

### 1. API 返回值统一类型定义

```ts
// types/api.ts
interface ApiResponse<T = any> {
  code: number
  message: string
  data: T
}

interface PaginatedData<T> {
  list: T[]
  total: number
  page: number
  pageSize: number
}

// 使用
type UserListResponse = ApiResponse<PaginatedData<User>>
```

配合请求封装：

```ts
// utils/request.ts
import axios from 'axios'

const instance = axios.create({ baseURL: '/api' })

export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  const response = await instance.request<ApiResponse<T>>(config)
  if (response.data.code !== 0) {
    throw new Error(response.data.message)
  }
  return response.data.data
}

// 调用时自动推导类型
const users = await request<PaginatedData<User>>({ url: '/users' })
// users.list -> User[]  ✅ 类型安全
```

### 2. 用 `as const` + 映射类型管理枚举

比 `enum` 更灵活的做法：

```ts
const STATUS_MAP = {
  draft: '草稿',
  pending: '待审核',
  published: '已发布',
  archived: '已归档',
} as const

// 自动推导出联合类型
type Status = keyof typeof STATUS_MAP
// 'draft' | 'pending' | 'published' | 'archived'

// 获取中文名
function getStatusLabel(status: Status): string {
  return STATUS_MAP[status]
}
```

### 3. 组件 Props 类型提取

```ts
// 从组件中提取 Props 类型，方便外部使用
import type { ComponentProps } from 'vue'
import MyButton from './MyButton.vue'

type MyButtonProps = ComponentProps<typeof MyButton>
```

### 4. 判别联合类型（Discriminated Unions）

处理多种状态或响应时特别好用：

```ts
type RequestState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: string }

function renderState<T>(state: RequestState<T>) {
  switch (state.status) {
    case 'idle':
      return '等待操作'
    case 'loading':
      return '加载中...'
    case 'success':
      return `数据: ${state.data}` // ✅ TS 知道这里有 data
    case 'error':
      return `错误: ${state.error}` // ✅ TS 知道这里有 error
  }
}
```

### 5. 工具类型实际用法

```ts
// 把对象所有属性变为可选（适合表单搜索参数）
type SearchParams = Partial<User>

// 只选取部分字段（适合列表展示）
type UserListItem = Pick<User, 'id' | 'name' | 'avatar'>

// 排除某些字段（适合创建接口）
type CreateUserParams = Omit<User, 'id' | 'createdAt'>

// 所有属性变为必填（适合提交校验）
type RequiredUser = Required<User>
```

## 收获

1. **类型即文档**：好的类型定义比注释更可靠，调用方看类型就知道怎么传参
2. **编译时发现错误**：很多低级 bug 在写代码时就被发现，不用等到运行时
3. **重构更安全**：改了接口定义，所有引用处立刻报错，不会遗漏
4. **团队协作更顺畅**：类型约束让代码意图更明确

::: tip 给 TS 新手的建议
- 先从接口返回值类型开始定义，这是收益最大的地方
- 不要追求 100% 类型覆盖，关键路径类型正确就行
- `any` 不是敌人，但 `unknown` 通常是更好的选择
- 善用 IDE 的类型推导，鼠标悬停看类型，比硬记语法有用
:::
