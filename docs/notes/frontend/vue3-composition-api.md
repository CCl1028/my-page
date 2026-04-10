# Vue3 组合式 API 实践总结

## 背景

我们团队的一个中后台项目原本基于 Vue 2 + Options API 开发，随着业务迭代，组件越来越臃肿，逻辑复用困难，维护成本直线上升。趁着 Vue 3 生态成熟，我们决定在新模块中全面使用 Composition API，并逐步迁移老代码。

## 问题

Options API 在大型组件中最明显的痛点：

1. **逻辑分散**：同一个功能的 data、methods、computed、watch 散落在不同位置
2. **复用困难**：Mixins 存在命名冲突和隐式依赖问题
3. **类型支持差**：TypeScript 在 Options API 下的类型推导很吃力

## 方案

我们采用 `<script setup>` + Composables 的模式：

- 每个独立功能抽成一个 `useXxx` 函数
- 使用 `ref` / `reactive` 管理响应式状态
- 通过 `computed` 和 `watch` 处理派生状态和副作用

## 实现

### 典型的 Composable 封装

以表格列表页为例，封装一个通用的 `useTable`：

```ts
// composables/useTable.ts
import { ref, reactive } from 'vue'

interface UseTableOptions<T> {
  fetchApi: (params: any) => Promise<{ list: T[]; total: number }>
  defaultPageSize?: number
}

export function useTable<T>(options: UseTableOptions<T>) {
  const { fetchApi, defaultPageSize = 20 } = options

  const loading = ref(false)
  const dataList = ref<T[]>([]) as Ref<T[]>
  const pagination = reactive({
    current: 1,
    pageSize: defaultPageSize,
    total: 0,
  })

  async function fetchData(params = {}) {
    loading.value = true
    try {
      const { list, total } = await fetchApi({
        page: pagination.current,
        pageSize: pagination.pageSize,
        ...params,
      })
      dataList.value = list
      pagination.total = total
    } catch (error) {
      console.error('获取列表失败:', error)
    } finally {
      loading.value = false
    }
  }

  function handlePageChange(page: number) {
    pagination.current = page
    fetchData()
  }

  return {
    loading,
    dataList,
    pagination,
    fetchData,
    handlePageChange,
  }
}
```

### 在组件中使用

```vue
<script setup lang="ts">
import { onMounted } from 'vue'
import { useTable } from '@/composables/useTable'
import { getUserList } from '@/api/user'

const { loading, dataList, pagination, fetchData, handlePageChange } = useTable({
  fetchApi: getUserList,
  defaultPageSize: 15,
})

onMounted(() => {
  fetchData()
})
</script>
```

### 组合多个 Composable

一个完整的列表页通常需要多个功能组合：

```vue
<script setup lang="ts">
import { useTable } from '@/composables/useTable'
import { useSearch } from '@/composables/useSearch'
import { useSelection } from '@/composables/useSelection'

const { loading, dataList, pagination, fetchData } = useTable({ fetchApi: getList })
const { searchForm, handleSearch, handleReset } = useSearch({ onSearch: fetchData })
const { selectedRows, handleSelect, clearSelection } = useSelection()
</script>
```

这样每个功能独立、可测试、可复用，组件只负责「组装」。

## 收获

1. **代码组织**：同一功能的代码集中在一个 Composable 中，阅读体验好很多
2. **复用能力**：比 Mixins 更灵活、更安全，不存在命名冲突
3. **TypeScript 友好**：类型推导天然支持，写起来很顺滑
4. **渐进迁移**：可以在老项目中逐步使用，不需要一次性重写

::: tip 实践建议
- 不是所有逻辑都需要抽成 Composable，简单组件用 `<script setup>` 直接写就行
- Composable 内部尽量不依赖组件上下文（如 `$router`），通过参数传入
- 命名统一用 `useXxx`，保持团队一致性
:::

::: warning 注意
`ref` 和 `reactive` 不要混用。团队建议统一用 `ref`，因为 `reactive` 解构后会丢失响应性，容易踩坑。
:::
