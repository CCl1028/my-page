# iOS scroll-view bounces 属性失效：排查与解决

## 背景

一个看似简单的页面：横向 `scroll-view`，里面的内容会动态增减。设置了 `bounces="{{false}}"` 禁用 iOS 的弹性回弹——这是一个再常规不过的配置。

测试同学提了个 bug：「iOS 上滑到头会弹一下，Android 没问题。」

我一看代码，`bounces` 明明写了 `false`，开发者工具里也好好的。拿真机一试，果然弹了。但诡异的是——**不是每次都弹**。反复测试后发现了规律：页面刚进来只有 1~2 个元素（不足一屏）时正常，等动态加了几个元素撑过一屏之后，弹性就出来了，而且之后就一直在。

这不是代码写错了，是 iOS WebView 的一个状态管理 bug。

---

## 问题

横向滚动的 `scroll-view` 设置了 `bounces="{{false}}"` 禁用弹性回弹，但在特定场景下失效：

- **正常**：页面首次加载时内容已超一屏 → bounces 生效
- **异常**：首次加载时内容不足一屏，后续动态添加内容使宽度超出 → bounces 失效，出现不该有的弹性回弹

仅 iOS 平台复现，Android 无此问题。

## 根因

iOS 对 `scroll-view` 有特殊的内存管理机制。当组件从「不可滚动」状态（内容 ≤ 容器）变为「可滚动」状态时，iOS 会重新计算滚动参数，但**不会重新应用 `bounces` 设置**。

本质上是一个 iOS WebView 的状态转换 bug：`bounces` 只在组件初始化为「可滚动」时生效，后续从不可滚动切换为可滚动时不会重新读取该属性。

## 方案对比

| 方案 | 思路 | 结果 |
|------|------|------|
| ✅ **始终保持可滚动** | 内容宽度始终 ≥ 1.5 屏，避免状态转变 | 彻底解决，无副作用 |
| ⚠️ wx:if 销毁重建 | 检测到宽度变化时销毁 scroll-view 再重建 | 可行但有视觉闪烁 |
| ❌ 动态修改 bounces | 通过 WXS 重新设置 bounces 值 | 无效，iOS 不响应相同值的重新设置 |
| ❌ CSS overscroll-behavior | 用 CSS 属性控制弹性 | 小程序不支持 |

## 最终方案：始终保持可滚动

核心思路：**确保 scroll-view 的内容宽度始终大于容器宽度，从一开始就处于可滚动状态，永远不会触发「不可滚动 → 可滚动」的状态切换。**

```javascript
const MIN_WIDTH = 1125  // 1.5 屏宽，确保始终可滚动

function calculateContentWidth(itemCount) {
  const naturalWidth = itemCount * ITEM_WIDTH + MARGIN
  return Math.max(naturalWidth, MIN_WIDTH)
}
```

```javascript
Page({
  data: {
    contentWidth: MIN_WIDTH,  // 初始值就大于一屏
  }
})
```

内容少于一屏时，用户只能滑动一小段空白就到头了（约 0.5 屏），体感上就像「到底了」，不影响使用。

## 结论

遇到 iOS `scroll-view` 的 `bounces`、`scroll-with-animation` 等属性在动态内容下失效时，优先考虑「始终保持可滚动状态」这个方案——改动极小（一行 `Math.max`），零闪烁，零副作用。
