# Prompt Engineering 入门实践

## 背景

在日常开发中越来越多地使用大模型辅助工作——写代码、查 bug、写文档、做翻译。发现同样的问题，不同的 prompt 写法，得到的结果质量差异巨大。

于是花了一些时间系统学习 Prompt Engineering，这篇文章记录我觉得**最实用、最高频**的几个技巧。

## 问题

新手写 prompt 常见的问题：

1. **太模糊**：「帮我写个函数」——写什么函数？输入输出是什么？
2. **缺少上下文**：不提供背景信息，模型只能猜
3. **一次性要求太多**：一个 prompt 塞了 5 个要求，结果哪个都没做好
4. **没有约束输出格式**：想要 JSON 却得到一段散文

## 方案

掌握以下几个核心技巧，能解决 80% 的 prompt 质量问题。

## 实现

### 1. 明确角色 + 任务 + 约束

```
你是一位资深前端工程师。
请帮我 review 以下代码，指出潜在的性能问题和可维护性问题。
要求：
- 每个问题给出具体代码行
- 说明问题原因
- 给出改进建议
- 用中文回答
```

结构清晰，模型不会跑偏。

### 2. Few-shot：给示例比讲规则更有效

```
请将以下技术术语翻译成适合中文技术文章的表达：

示例：
- "race condition" → "竞态条件"
- "side effect" → "副作用"
- "syntactic sugar" → "语法糖"

请翻译：
- "tree shaking"
- "code splitting"
- "hot module replacement"
```

模型通过示例理解风格和格式，比你描述半天效果好。

### 3. Chain of Thought：让模型分步思考

```
请分析这段代码的 bug。请按以下步骤思考：

1. 先阅读代码，理解它的意图
2. 找出代码实际的执行流程
3. 对比意图和实际执行，找到差异
4. 解释 bug 的原因
5. 给出修复方案
```

对于复杂问题，分步引导比直接问「有什么 bug」效果好很多。

### 4. 约束输出格式

```
请分析这个 API 的性能瓶颈，以 JSON 格式返回：

{
  "bottlenecks": [
    {
      "location": "具体位置",
      "problem": "问题描述",
      "impact": "high | medium | low",
      "suggestion": "优化建议"
    }
  ]
}
```

需要结构化输出时，直接给 schema 比口头描述靠谱。

### 5. 设定边界和负面指令

```
请用简洁的中文解释 React 的 useEffect。

要求：
- 面向有 Vue 经验但没用过 React 的开发者
- 类比 Vue 的生命周期和 watch 来解释
- 不要讲原理，只讲用法和常见场景
- 不超过 300 字
```

告诉模型**不要做什么**，和告诉它**要做什么**一样重要。

### 6. 迭代优化

Prompt 很少一次就完美。我的工作流：

1. 先写一个初版 prompt，看效果
2. 分析结果哪里不满意
3. 针对性地补充约束或示例
4. 重复直到满意
5. 把好用的 prompt 存成模板

## 收获

1. **Prompt 是一种编程语言**：它有语法（结构）、有调试（迭代），值得认真对待
2. **上下文为王**：给模型的信息越充分、越结构化，输出越好
3. **Few-shot 是万能药**：很多时候与其解释规则，不如给两个例子
4. **分步比一步到位好**：复杂任务拆开，比一次性全塞效果好
5. **存模板**：高频场景的 prompt 模板化，提升日常效率

::: tip 推荐资源
- [OpenAI Prompt Engineering Guide](https://platform.openai.com/docs/guides/prompt-engineering)
- [Anthropic Prompt Engineering](https://docs.anthropic.com/claude/docs/prompt-engineering)
- [Learn Prompting](https://learnprompting.org/zh-Hans)
:::
