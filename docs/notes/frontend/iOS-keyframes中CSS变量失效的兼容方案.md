# iOS @keyframes 中 CSS 变量失效的兼容方案

## 背景

做一个交互式动画：多个元素围绕中心点环形排列，用户触发后按各自轨迹飞出。每个元素的终点坐标、旋转角度、延迟、时长都不同（随机生成），需要动态传入。

自然的思路是用 CSS 变量：inline style 写入 `--fly-end-transform`，然后 `@keyframes` 里 `transform: var(--fly-end-transform)`。Android 和开发者工具都完美运行，信心满满提交测试——

**iOS 上元素纹丝不动。**

---

## 问题

iOS WebKit（Safari 引擎）有一个已知限制：**不支持在 `@keyframes` 规则中将 CSS 变量用作 `transform` 属性值**。

```css
/* ❌ iOS 无法解析 */
@keyframes fly-away {
  100% { transform: var(--fly-end-transform); }
}
```

| 平台 | 表现 |
|------|------|
| Android（Chromium） | ✅ 正常 |
| iOS（WebKit） | ❌ transform 不生效 |
| 开发者工具（Chrome） | ✅ 正常 |

这是 WebKit 的已知 Bug（[webkit.org #168829](https://bugs.webkit.org/show_bug.cgi?id=168829)），至今未修复。

---

## 解法：transition 替代 animation

核心思路：**不用 `@keyframes`，改用 `transition`。通过 JS 分两步 setData：先设初始态，延迟 50ms 后设终态，浏览器检测到 transform 值变化后自动执行过渡动画。**

### 模板

```xml
<view
  wx:for="{{items}}"
  wx:key="id"
  wx:if="{{!item.gone}}"
  class="item {{item.flying ? 'flying' : ''}}"
  style="transform: {{item.baseTransform}}; {{item.animatedTransform}}"
/>
```

- `baseTransform`：初始位置（环形排列的坐标 + 旋转）
- `animatedTransform`：飞出时动态注入 `transition: transform Xs ease-out; transform: translate(...) rotate(...);`

### JS 触发逻辑

```javascript
startFlying(batch) {
  // Step 1: 标记 flying 状态（元素进入待飞状态）
  const items = this.data.items.map(item => {
    if (item.batch === batch) return { ...item, flying: true }
    return item
  })
  this.setData({ items })

  // Step 2: 延迟注入终态（触发 transition）
  items.forEach((item, index) => {
    if (item.batch !== batch) return
    const delay = item.flyDelay * 1000 + 50  // +50ms 确保渲染层已更新

    setTimeout(() => {
      const style = `transition: transform ${item.flyDuration}s ease-out; transform: ${item.flyEndTransform};`
      this.setData({ [`items[${index}].animatedTransform`]: style })
    }, delay)
  })
}
```

### 为什么必须分两步？

```
❌ 一步到位：setData 同时写入 flying + animatedTransform
   → 浏览器认为元素"初始状态就是终态"，不触发过渡

✅ 分两步：先 setData 初始态 → 延迟 50ms → 再 setData 终态
   → 浏览器检测到 transform 值从 A 变成 B，触发 transition
```

50ms 是让渲染层完成一次完整渲染周期的经验值（16ms 在低端机上不稳定）。

---

## 完整数据生成示例

```javascript
generateItems() {
  const items = []
  const count = 16
  const radius = 50

  for (let i = 0; i < count; i++) {
    const angle = (360 / count) * i
    const radian = (angle * Math.PI) / 180

    // 环形初始位置
    const baseX = Math.cos(radian) * radius
    const baseY = Math.sin(radian) * radius
    const baseRotate = angle + 90

    // 随机飞行终点
    const flyX = 800 + Math.random() * 400
    const flyY = -100 + (Math.random() - 0.5) * 600
    const flyRotate = 120 + Math.random() * 240

    items.push({
      id: i,
      batch: Math.floor(Math.random() * 3),  // 分 3 批飞出
      flying: false,
      gone: false,
      baseTransform: `translate(${baseX}rpx, ${baseY}rpx) rotate(${baseRotate}deg)`,
      flyEndTransform: `translate(${baseX + flyX}rpx, ${baseY + flyY}rpx) rotate(${baseRotate + flyRotate}deg)`,
      flyDelay: Math.random() * 0.8,
      flyDuration: 2.5 + Math.random() * 4,
      animatedTransform: ''
    })
  }
  return items
}
```

---

## 对比

| | CSS Animation + 变量 | Transition + JS 注入 |
|---|---|---|
| iOS 兼容性 | ❌ | ✅ |
| Android | ✅ | ✅ |
| 复杂时间轴 | ✅ 支持多关键帧 | ⚠️ 只支持 A→B 两态 |
| 性能 | ⚡ 纯 GPU | ⚡ 纯 GPU（transition 同样走合成层） |
| 代码复杂度 | 简单 | 中等（需要管理 setData 时序） |

---

## 额外收获：吹气检测 + 摇一摇的鸿蒙兼容

这个组件还支持麦克风吹气检测（通过 `RecorderManager` 的 `onFrameRecorded` 回调分析音频振幅）。在鸿蒙系统上遇到两个问题：

1. **降噪过于激进**：华为/荣耀设备的系统级降噪会把吹气声过滤掉，需要降低检测阈值（0.1 → 0.05）。
2. **onFrameRecorded 不回调**：部分鸿蒙设备帧回调完全不触发，需要设置超时检测并降级为摇一摇交互。

```javascript
const isHuawei = /huawei|honor|harmonyos/i.test(systemInfo.brand || '')

audioDetector.configure({
  volumeThreshold: isHuawei ? 0.05 : 0.1,
  lowFreqThreshold: isHuawei ? 20 : 30,
  frameSize: isHuawei ? 5 : 10,  // 更小的帧避免回调不触发
})
```

---

## 可复用结论

1. **iOS WebKit 不支持 `@keyframes` 中使用 CSS 变量作为 transform 值**。这是一个至今未修复的 Bug，遇到时只能绕过。
2. **绕过方案：transition + JS 两步 setData**。先设初始态，延迟 50ms 后设终态，利用 transition 实现动画。
3. **50ms 是安全间隔**。确保渲染层完成一次完整渲染周期，低于此值在低端机上不稳定。
4. **鸿蒙的麦克风降噪极其激进**。涉及音频检测时，需要为华为/荣耀设备单独降低阈值或提供降级交互。
