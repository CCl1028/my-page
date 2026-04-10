# 从零搭建一个 AI Agent 的踩坑记录

## 背景

最近用 LangChain + OpenAI API 搭建了一个内部工具型 Agent，功能是根据用户自然语言描述，自动查询数据库、生成报表、发送通知。

听起来简单，做起来全是坑。这篇文章记录整个过程中踩的主要问题。

## 问题

第一版 Agent 上线后遇到的核心问题：

1. **Tool 调用不稳定**：模型时灵时不灵，有时候不调工具，有时候调错工具
2. **上下文爆炸**：多轮对话后 token 超限，Agent 直接报错
3. **错误处理缺失**：Tool 报错后 Agent 不知道怎么恢复
4. **响应太慢**：一次完整流程要 30 秒以上

## 方案

逐个击破，最终形成了一套相对稳定的 Agent 架构。

## 实现

### 1. 解决 Tool 调用不稳定

**原因**：Tool 的 description 写得太模糊，模型不确定该用哪个。

**修复前**：

```python
tools = [
    Tool(name="query", description="查询数据", func=query_data),
    Tool(name="report", description="生成报表", func=generate_report),
]
```

**修复后**：

```python
tools = [
    Tool(
        name="query_database",
        description="""查询业务数据库。
        输入格式：JSON 字符串，包含以下字段：
        - table: 表名（必填），可选值：users, orders, products
        - conditions: 查询条件（可选），如 {"status": "active"}
        - limit: 返回条数（可选），默认 10
        示例输入：{"table": "orders", "conditions": {"status": "paid"}, "limit": 5}
        返回：查询结果的 JSON 数组""",
        func=query_data,
    ),
]
```

**总结**：Tool description 要写得像 API 文档，包含输入格式、可选值、示例。

### 2. 解决上下文爆炸

采用了**滑动窗口 + 摘要**的策略：

```python
from langchain.memory import ConversationSummaryBufferMemory

memory = ConversationSummaryBufferMemory(
    llm=llm,
    max_token_limit=2000,  # 超过这个长度就开始摘要
    return_messages=True,
)
```

同时对 Tool 的输出做了截断：

```python
def query_data(input_str: str) -> str:
    result = execute_query(input_str)
    # 限制返回长度，避免撑爆上下文
    result_str = json.dumps(result, ensure_ascii=False)
    if len(result_str) > 2000:
        result_str = result_str[:2000] + "\n... (结果已截断，共 {} 条)".format(len(result))
    return result_str
```

### 3. 加入错误恢复机制

给 Agent 加了一个 System Prompt 来引导错误处理：

```python
system_prompt = """你是一个数据分析助手。

当工具调用失败时，请遵循以下规则：
1. 如果是参数格式错误，修正参数后重试一次
2. 如果是权限不足或表不存在，告诉用户具体原因
3. 最多重试 2 次，仍然失败则向用户说明情况
4. 永远不要编造数据
"""
```

同时在 Tool 层面做了友好的错误返回：

```python
def safe_tool_wrapper(func):
    def wrapper(input_str: str) -> str:
        try:
            return func(input_str)
        except json.JSONDecodeError:
            return "错误：输入格式不是有效的 JSON，请检查格式后重试"
        except PermissionError as e:
            return f"错误：权限不足 - {str(e)}"
        except Exception as e:
            return f"错误：{str(e)}，请调整参数后重试"
    return wrapper
```

### 4. 优化响应速度

- **流式输出**：让用户尽快看到第一个 token
- **并行 Tool 调用**：支持同时查多张表
- **缓存热点查询**：相同查询 5 分钟内走缓存

```python
from functools import lru_cache
from datetime import datetime

@lru_cache(maxsize=100)
def cached_query(table: str, conditions_hash: str, minute_bucket: int):
    """按分钟粒度缓存查询结果"""
    return execute_query(table, conditions_hash)
```

## 收获

1. **Tool Description 是核心**：Agent 能力的上限取决于 Tool 设计的质量
2. **防御性编程很重要**：模型的输出不可控，每一层都要做好异常处理
3. **上下文管理是必修课**：不管理 token 消耗，Agent 用不了几轮就崩了
4. **先跑通再优化**：第一版不要追求完美，先实现核心链路，再逐步打磨

::: warning Agent 开发最大的坑
不要假设模型会按你想的方式调用 Tool。一定要做好输入校验和异常处理，把 Agent 当成一个"不太靠谱的实习生"来设计交互。
:::
