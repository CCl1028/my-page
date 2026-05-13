# 小程序 page-container 实现实时预览与手势返回拦截

## 背景

接到一个换肤/主题预览的需求：用户在商品列表中点击某个主题，**不关闭列表**的前提下实时预览主题效果（背景图切换），预览完可以右滑返回列表继续浏览。

听起来简单，但在小程序里要同时满足三个条件非常棘手：

1. **列表状态不丢失**（滚动位置、已加载数据）
2. **支持原生手势返回**（右滑 = 返回列表，而不是关闭弹窗）
3. **预览时能透视到父页面背景**（列表本身变透明，露出后面的换肤效果）

试了跳转新页面（状态丢失）、wx:if 切换（无手势返回）、自定义导航（兼容性地狱），最后发现 `page-container` 刚好能满足全部要求。

---

## 核心方案：page-container + opacity 切换

### 架构分层

```
┌─────────────────────────────────────────────┐
│  父页面                                      │
│  ├── 背景层（可动态切换：默认 / 预览主题）    │
│  ├── 页面内容                                │
│  └── 商品弹窗组件                            │
│       ├── page-container（背景透明）         │
│       │    └── 列表视图（opacity 控制可见性） │
│       └── 预览模式 UI（在 container 外部）   │
│            ├── 假返回按钮                    │
│            └── 底部操作栏                    │
└─────────────────────────────────────────────┘
```

关键点：
- `page-container` 设置 `overlay="{{false}}"` + `custom-style="background-color: transparent;"`，背景完全透明
- 列表视图通过 CSS `opacity: 0/1` 切换可见性（而非 wx:if 销毁），**DOM 常驻，状态不丢失**
- 预览模式的 UI（返回按钮、操作栏）放在 `page-container` **外部**，不受透明度影响

### 视图切换

```javascript
data: {
  currentView: 'list',       // 'list' | 'preview'
  _viewStack: ['list'],      // 视图栈
  innerShowContainer: false,  // 内部控制 page-container 显示
}

// 进入预览
onProductClick(e) {
  this.data._viewStack.push('preview')
  this.setData({ currentView: 'preview', previewProduct: product })
  this.triggerEvent('enterPreview', { skinCode })
}

// 返回列表
onBackToList() {
  this.data._viewStack.pop()
  this.setData({ currentView: 'list', previewProduct: null }, () => {
    setTimeout(() => this.triggerEvent('previewEnd'), 320)
  })
}
```

```less
.list-view {
  transition: opacity 300ms ease-in-out;
  &.show { opacity: 1; }
  &.hide { opacity: 0; pointer-events: none; }
}
```

---

## 核心难点：拦截手势返回

### 问题

用户在预览模式下右滑返回，`page-container` 会直接关闭（退出弹窗）。但预期行为是：**回到列表视图**，而非关闭。

### 解法：beforeleave 中快速关闭再重开

`page-container` 的 `beforeleave` 事件无法阻止关闭，但可以通过「关闭 → 10ms → 重开并切换视图」实现伪拦截：

```javascript
onBeforeLeave() {
  if (this.data.currentView === 'preview') {
    // Step 1：关闭
    this.setData({ innerShowContainer: false })
    // Step 2：10ms 后重开，切换到列表
    setTimeout(() => {
      this.setData({
        innerShowContainer: true,
        currentView: 'list',
        previewProduct: null
      }, () => {
        setTimeout(() => this.triggerEvent('previewEnd'), 320)
      })
      this.data._viewStack = ['list']
    }, 10)
    return
  }
  // 列表视图 → 允许正常关闭
}
```

10ms 的间隔让用户感知不到闪烁，但足以让系统识别为"新的一次打开"。

---

## 核心难点：时序控制（防闪烁）

### 问题

从预览返回列表时，如果立即通知父页面切换背景，用户会看到：「列表还是透明的 → 背景先变了 → 闪烁」。

### 解法：先等列表完全显示，再切换背景

```javascript
// ❌ 错误：立即切换 → 闪烁
onBackToList() {
  this.setData({ currentView: 'list' })
  this.triggerEvent('previewEnd')  // 背景立即变，但列表还透明
}

// ✅ 正确：等 opacity 动画结束再切换
onBackToList() {
  this.setData({ currentView: 'list' }, () => {
    // setData 回调 = 数据到达渲染层，CSS 动画刚开始
    // 再等 320ms = CSS transition 300ms + 20ms 缓冲
    setTimeout(() => this.triggerEvent('previewEnd'), 320)
  })
}
```

时序图：

```
T0   setData({ currentView: 'list' })
T20  数据到达渲染层，opacity 动画开始 (0 → 1)
T320 opacity 动画结束，列表完全显示
T340 triggerEvent('previewEnd')，父页面切换背景
     ↑ 此时列表已不透明，背景切换用户无感知 ✅
```

> 关键认知：`setData` 回调只代表数据已传到渲染层，**不代表 CSS 动画已完成**。

---

## 防误触与边界处理

### 1. afterleave 误触发

拦截返回时 `setData({ innerShowContainer: false })` 会触发 `afterleave`，导致父组件误关闭。解法：标记位。

```javascript
onBeforeLeave() {
  if (currentView === 'preview') {
    this._intercepting = true
    // ... 关闭再重开 ...
    setTimeout(() => { this._intercepting = false }, 50)
  }
}

onAfterLeave() {
  if (this._intercepting) return  // 拦截期间不触发
  this.triggerEvent('close')
}
```

### 2. 快速连点防抖

```javascript
onProductClick(e) {
  if (this._switching) return
  this._switching = true
  this.setData({ currentView: 'preview' }, () => {
    setTimeout(() => { this._switching = false }, 300)
  })
}
```

### 3. 页面跳转返回后防误触

从当前组件跳转到其他页面再返回时，`page-container` 可能会立即响应点击。解法：返回后 400ms 内忽略交互。

```javascript
pageLifetimes: {
  show() {
    if (this._navigatingAway) {
      this._navigatingAway = false
      this._justOpened = true
      setTimeout(() => { this._justOpened = false }, 400)
    }
  }
}
```

---

## 方案对比

| 方案 | 状态保持 | 手势返回 | 背景透视 | 推荐 |
|------|:---:|:---:|:---:|:---:|
| 跳转新页面 | ❌ | ✅ | ❌ | |
| view + wx:if 切换 | ✅ | ❌ | ❌ | |
| **page-container + opacity** | **✅** | **✅** | **✅** | **✅** |

---

## 可复用结论

1. **page-container + 透明背景 + opacity 切换** = 同时满足"状态保持 + 手势返回 + 背景透视"的唯一方案。
2. **beforeleave 关闭再重开（10ms）** = 小程序中拦截 page-container 手势返回的通用 trick。
3. **setData 回调 ≠ 动画完成**。要等 CSS transition 结束后再做后续操作，延迟 = transition 时长 + 20ms 缓冲。
4. **预览 UI 放在 page-container 外部**，否则会被容器的透明度/动画影响。
5. 涉及多步异步切换时，**标记位 + 防抖** 是必须的防御措施。
