# 在微信小程序中实现一个 2D RPG 跑图引擎

## 一、引言

假设你接到一个需求：在微信小程序里做一个可自由漫游的 2D 大地图——用户操控一个小角色，在一片铺满元素的世界中四处行走。地图可能延伸数个屏幕宽，纵向高达数千 rpx，场景中散布着数百甚至上千个可交互节点，角色走过时还有碰撞检测和粒子特效。

听起来像是 Canvas 游戏引擎干的事，但你的约束是：**必须用小程序原生 WXML/WXSS 实现**——因为需要保留节点的点击交互能力，Canvas 层级会遮挡弹窗等原生组件。

这意味着你面对的是小程序最大的性能瓶颈——**双线程架构下的 setData 通信开销**。逻辑层和渲染层是两个独立线程，每次 setData 都要经历「序列化 → 跨线程传输 → 反序列化 → DOM diff → 渲染」这条完整链路，单次耗时 3~8ms。而 60fps 要求每帧只有 16ms。

本文记录了在这个约束下，如何从零搭建一套完整的 2D 跑图引擎，涵盖分层渲染、虚拟滚动、空间索引、碰撞系统、镜头控制、增量加载、帧动画、以及 setData 的极限优化策略。

---

## 二、整体架构设计

### 2.1 分层渲染模型

地图采用 **7 层渲染架构**，每层承担不同职责：

| 层级 | 名称 | 内容 | z-index 策略 |
|------|------|------|-------------|
| L0 | 地面纹理层 | CSS `background-repeat` 平铺的草地纹理 | 固定最底层 |
| L1 | 道路层 | 每个面板一张大尺寸背景图，通过 `left` 偏移拼接 | 固定 |
| L2 | 后景装饰层 | z-index 低于角色的装饰物（地面摆件等），部分带碰撞盒 | 按碰撞盒底部 Y 动态计算 |
| L3 | 可交互元素层 | 花朵等核心节点，支持点击弹出气泡 | 按元素底部 Y 动态计算 |
| L4 | 角色层 | sprite sheet 帧动画 | 按脚部 Y 动态计算 |
| L5 | 前景遮挡层 | z-index 高于角色的装饰物（如树冠），走到下方时被遮挡 | 按底部 Y + 偏移量 |
| L6 | 标记物层 | 未激活区域的路牌，带碰撞盒阻挡通过 | 按碰撞盒底部 Y 动态计算 |

所有层共处于一个绝对定位的世界容器中，镜头移动通过修改容器的 `transform: translate3d()` 实现。

### 2.2 数据流

整体数据流是一个经典的游戏循环：

```
摇杆输入(angle, force)
  → setInterval 物理帧循环(32ms)
    → 计算位移 dx/dy
    → 碰撞检测(边界 + 障碍物)
    → Wall Sliding 滑墙处理
    → 更新角色坐标(_charX, _charY)
    → 计算镜头偏移
    → [降频] 计算可见节点列表
    → 合批 setData → 渲染
    → 检查增量加载
    → [降频] 元素碰撞检测 → 粒子特效
```

### 2.3 坐标系

引擎使用两套坐标系：

- **世界坐标系（rpx）**：所有元素的绝对位置，原点在地图左上角。
- **屏幕坐标系（px）**：用户可见区域。通过 `rpxRatio = screenWidth / 750` 转换。

镜头偏移公式：

```javascript
offsetX = screenWidth / 2 / rpxRatio - charX
// clamp 到地图边界
offsetX = Math.min(0, Math.max(screenWidth - mapTotalWidth, offsetX))
```

---

## 三、虚拟滚动与视窗裁剪

### 3.1 问题

一张地图上可能有上千个可交互元素、几百个装饰物、几十个标记物。如果全部创建为 WXML 节点，小程序会直接卡死——不是 setData 的问题，而是 DOM 节点数量本身就超出了渲染层的承受能力。

### 3.2 方案：只渲染视窗内的节点

核心思路：维护一个「全量数据数组」，但只把视窗范围内的子集通过 setData 推送给渲染层。

视窗范围 = 角色位置 ± 屏幕尺寸 × 缓冲倍数（如 1.1 倍），缓冲区略大于屏幕，确保边缘元素的出场动画不会被裁掉。

### 3.3 可交互元素：O(N) 线性扫描 + AABB 裁剪

可交互元素采用全量遍历 + AABB 矩形碰撞判断：

```javascript
for (const f of this._allItems) {
  // 用元素的完整包围盒判断，避免仅用左上角坐标导致大尺寸元素被提前裁切
  if (f.x + f.w >= viewLeft && f.x <= viewRight &&
      f.y + f.h >= viewTop && f.y <= viewBottom) {
    visibleItems.push(/* 只投递渲染必要字段 */)
  }
}
```

为什么不用空间索引？因为这些元素需要追踪「首次进入视窗」的状态（用于触发出场动画），全量遍历的过程中可以顺便维护 `_seenItems` 集合。当总量超过阈值（如 5000）时，触发 GC 清理不在视窗内的状态记录。

### 3.4 装饰物/标记物：空间网格索引

装饰物和标记物没有「首次出现」的状态追踪需求，适合用空间索引优化到 O(格子数)：

```javascript
// 入桶：按元素左上角坐标计算所在格子
function putItemToSpatialGrid(grid, item, gridSize) {
  const gx = Math.floor(item.x / gridSize)
  const gy = Math.floor(item.y / gridSize)
  const key = `${gx}_${gy}`
  if (!grid[key]) grid[key] = []
  grid[key].push(item)
}

// 查询：遍历视窗覆盖的所有格子
function querySpatialGrid(grid, gridSize, left, right, top, bottom, queryTag, scratch) {
  scratch.length = 0
  const minGX = Math.floor(left / gridSize)
  const maxGX = Math.floor(right / gridSize)
  const minGY = Math.floor(top / gridSize)
  const maxGY = Math.floor(bottom / gridSize)
  for (let gx = minGX; gx <= maxGX; gx++) {
    for (let gy = minGY; gy <= maxGY; gy++) {
      const bucket = grid[`${gx}_${gy}`]
      if (!bucket) continue
      for (const item of bucket) {
        if (item._queryTag === queryTag) continue  // 跨格子去重
        item._queryTag = queryTag
        scratch.push(item)
      }
    }
  }
  return scratch
}
```

关键细节：

- **queryTag 去重**：同一元素可能跨多个格子，用单调递增的 tag 标记避免重复返回。
- **scratch 数组复用**：查询结果写入预分配的数组，避免每帧创建新数组触发 GC。
- **格子大小选择**：障碍物用 200rpx（密集，需精确查询），装饰物用 400rpx（稀疏，减少格子遍历数）。

### 3.5 降频策略

即使有了视窗裁剪，每帧重算可见列表仍然意味着每帧做一次 setData 推送完整数组（50~100 个对象）。两种降频策略：

**策略一：移动距离阈值**。角色移动累计超过阈值（如 30rpx）才刷新一次列表，约每 5 帧触发一次。

**策略二：移动冻结 + 停步刷新**。移动过程中完全不刷新列表，只推送角色坐标和镜头偏移（5 个数字）；松手停步后补一次完整刷新。由于整个世界容器是通过 CSS transform 平移的，已渲染的节点会自然跟随镜头移动，视觉上完全连贯。只有走到「全新区域」时，才会在停步后「补」出来。

> 策略二的 setData 数据量从每秒 ~150KB 降至 ~1KB，是对低端机提升最显著的单项优化。

---

## 四、空间索引与碰撞系统

### 4.1 障碍物网格

障碍物使用独立的空间网格索引，与装饰物的视窗查询网格分开维护。

坐标约定：障碍物用 **中心点坐标 + 宽高** 表示（而非左上角），这样 AABB 碰撞判断更直观：

```javascript
function checkAABBCollision(ax, ay, aw, ah, bx, by, bw, bh) {
  return Math.abs(ax - bx) < (aw + bw) / 2 &&
         Math.abs(ay - by) < (ah + bh) / 2
}
```

查询附近障碍物时，以角色碰撞盒中心为基准，扫描周围 ±1 格的所有桶：

```javascript
function queryNearbyObstacles(ctx, cx, cy, cw, ch) {
  const result = ctx._obsQueryScratch
  result.length = 0
  const gs = ctx._obsGridSize
  const minGX = Math.floor((cx - cw / 2) / gs) - 1
  const maxGX = Math.floor((cx + cw / 2) / gs) + 1
  const minGY = Math.floor((cy - ch / 2) / gs) - 1
  const maxGY = Math.floor((cy + ch / 2) / gs) + 1
  const queryTag = ++ctx._obsQueryTag
  for (let gx = minGX; gx <= maxGX; gx++) {
    for (let gy = minGY; gy <= maxGY; gy++) {
      const bucket = ctx._obsGrid[`${gx}_${gy}`]
      if (!bucket) continue
      for (const obs of bucket) {
        if (obs._queryTag === queryTag) continue
        obs._queryTag = queryTag
        result.push(obs)
      }
    }
  }
  return result
}
```

> **重要约束**：返回的 scratch 数组是复用的，调用方必须在同一个同步调用栈内立即消费完结果，不能保存引用或在异步回调中使用。

### 4.2 多碰撞盒组合

真实场景中很多物体不是规则矩形。一棵树可能树干细、树冠宽；一块石头可能底部不规则。

解决方案是支持 **碰撞盒数组**：一个物体可以配置多个碰撞盒，组合起来近似不规则形状：

```javascript
function resolveCollisionBoxes(itemX, itemY, itemW, itemH, collision) {
  if (!collision) {
    // 未配置：退化为整张图片的矩形包围盒
    return [{ x: itemX + itemW / 2, y: itemY + itemH / 2, w: itemW, h: itemH }]
  }
  const list = Array.isArray(collision) ? collision : [collision]
  return list.map(c => {
    const cw = parseFloat(c.width) || itemW
    const ch = parseFloat(c.height) || itemH
    const cox = parseFloat(c.offsetX) || 0
    const coy = parseFloat(c.offsetY) || 0
    return { x: itemX + cox + cw / 2, y: itemY + coy + ch / 2, w: cw, h: ch }
  })
}
```

配置示例：一个路牌图片 200×222rpx，碰撞盒只取底部木桩区域 60×20rpx：

```javascript
{ offsetX: 45, offsetY: 165, width: 60, height: 20 }
```

### 4.3 Wall Sliding 滑墙

最基础的碰撞响应是「撞墙就停」，但这会导致角色在斜向移动时频繁卡死——明明沿着墙可以滑过去，但因为 dx/dy 合成方向撞墙就完全不动了。

Wall Sliding 的思路是：撞墙后分轴尝试，让角色沿障碍物边缘滑行：

```javascript
// 合成方向碰撞 → 尝试只走 X
const slideX = detectCollision(ctx, oldX + slideDx, oldY)
if (!slideX.hitObstacle) {
  newX = oldX + slideDx; newY = oldY; return
}

// 只走 X 也不行 → 尝试只走 Y
const slideY = detectCollision(ctx, oldX, oldY + slideDy)
if (!slideY.hitObstacle) {
  newX = oldX; newY = oldY + slideDy; return
}

// 分轴都不行 → 垂直方向偏移绕过
// 主方向水平 → 尝试上下 nudge；主方向垂直 → 尝试左右 nudge
const nudge = speed * 0.7
if (Math.abs(dx) > Math.abs(dy)) {
  const tryUp = detectCollision(ctx, oldX + dx, oldY - nudge)
  if (!tryUp.hitObstacle) { newX = oldX + dx; newY = oldY - nudge; return }
  const tryDown = detectCollision(ctx, oldX + dx, oldY + nudge)
  if (!tryDown.hitObstacle) { newX = oldX + dx; newY = oldY + nudge; return }
}

// 完全卡死 → 保持原位
```

这三层降级确保了角色在复杂地形中的流畅移动：
1. **分轴滑行**：沿墙壁平滑滑动
2. **垂直偏移**：绕过凸起的拐角
3. **完全卡死**：极端情况兜底

### 4.4 安全位置搜索

角色入场时需要定位到某个地块的中心，但中心可能恰好在障碍物上。此时用 8 方向螺旋外扩搜索最近的安全位置：

```javascript
const SAFE_DIRS = [
  { dx: 0, dy: -1 }, { dx: 1, dy: -1 }, { dx: 1, dy: 0 }, { dx: 1, dy: 1 },
  { dx: 0, dy: 1 }, { dx: -1, dy: 1 }, { dx: -1, dy: 0 }, { dx: -1, dy: -1 },
]

function findSafePosition(x, y, step, maxDist) {
  if (!isColliding(x, y)) return { x, y }
  for (let dist = step; dist <= maxDist; dist += step) {
    for (const dir of SAFE_DIRS) {
      const tryX = x + dir.dx * dist
      const tryY = y + dir.dy * dist
      if (!isColliding(tryX, tryY)) return { x: tryX, y: tryY }
    }
  }
  return { x, y }  // 兜底
}
```

---

## 五、镜头系统与 GPU 加速

### 5.1 translate3d 零重排平移

镜头移动的实现方式决定了性能天花板。三种方案对比：

| 方案 | 实现 | 性能 |
|------|------|------|
| 修改每个节点的 left/top | 每帧 setData N 个节点的坐标 | 灾难级 |
| 修改容器 scroll-left/scroll-top | 触发重排 | 差 |
| **修改容器 transform: translate3d** | **仅触发 GPU 合成** | **最优** |

我们选择第三种：

```html
<view class="sea-world"
  style="transform: translate3d({{offsetX}}px, {{offsetY}}px, 0);">
  <!-- 所有地图元素都在这个容器内 -->
</view>
```

配合 CSS：

```css
.sea-world {
  position: absolute;
  will-change: transform;
}
```

`will-change: transform` 提示浏览器将该元素提升为独立合成层，后续的 transform 变更只需 GPU 重新合成，不触发 CPU 的布局计算和绘制。

### 5.2 亚像素跳过

镜头偏移每帧都在变化，但如果变化量不足 1px，推送给渲染层是无意义的（用户看不到，浏览器也不会重新合成）。加一个阈值过滤：

```javascript
const setObj = { charX, charY }
if (Math.abs(nextOX - this.data.offsetX) >= 1) setObj.offsetX = nextOX
if (Math.abs(nextOY - this.data.offsetY) >= 1) setObj.offsetY = nextOY
```

---

## 六、角色动画与摇杆操控

### 6.1 虚拟摇杆

摇杆采用「全屏触摸区域 + 摇杆组件代理」的设计：

- 地图视窗绑定 `touchstart/touchmove/touchend` 事件
- 事件坐标转发给摇杆组件，由组件计算方向和力度
- 摇杆组件通过 `triggerEvent` 将 `angle`、`force`、`direction` 回传给页面

这样用户在屏幕任意位置都能操控，不需要精确点击到摇杆区域。

### 6.2 sprite sheet 帧动画

角色的四方向行走动画使用 sprite sheet 实现：一张图片包含 8 帧，通过 CSS `background-position` 配合 `steps()` 播放：

```css
.character--walk {
  animation: characterWalk 0.8s steps(8) infinite;
}

@keyframes characterWalk {
  0%   { background-position: 0 0; }
  100% { background-position: 0 -1408rpx; }  /* 8帧 × 176rpx */
}
```

切换方向时只需换 `background-image` 到对应方向的 sprite sheet。为避免换图时闪白，入场时预加载全部四张图：

```javascript
for (const src of Object.values(WALK_SPRITES)) {
  wx.getImageInfo({ src })  // 触发下载并缓存
}
```

### 6.3 物理帧循环

摇杆激活后启动 `setInterval`，每帧推进角色位置：

```javascript
this._moveTimer = setInterval(() => this.moveCharacter(), THROTTLE)
```

节流时间的选择直接影响流畅度：

| 节流 | 帧率 | 适用场景 |
|------|------|---------|
| 16ms | 60fps | iOS / 高端 Android |
| 32ms | 30fps | 鸿蒙 / 低端机 |

16ms 在鸿蒙上会导致帧间隔不够（setData 通信本身就要 8~12ms），反而丢帧更严重。放宽到 32ms 后配合提高移动速度（保持体感一致），反而更稳。

### 6.4 动态 z-index

2D 俯视角游戏中，「谁在前面谁在后面」取决于 Y 坐标——Y 越大（越靠下），越在前面。

所有动态元素的 z-index 统一用底部 Y 坐标映射到一个数值范围：

```javascript
const zIndex = Math.floor(Z_MIN + (bottomY / MAP_HEIGHT) * Z_RANGE)
```

角色用脚部 Y 坐标：`bottomY = charY + CHARACTER_H / 2`
装饰物用碰撞盒底部 Y：`bottomY = collision.y + collision.h / 2`

这样角色走到树后面会被遮挡，走到树前面会遮挡树，无需手动调整层级。

---

## 七、增量加载与地图扩展

### 7.1 面板循环机制

地图由多个「面板」横向拼接而成，每个面板宽度固定。地块配置按固定周期循环复用——比如大地块有 13 种配置模板，第 14 个地块复用第 1 个模板的坐标布局，只是 X 坐标偏移了一个面板宽度。

```javascript
const configSeq = ((seq - 1) % CYCLE) + 1  // 周期内的模板序号
const panelIndex = Math.floor((seq - 1) / CYCLE)  // 第几张面板
const panelOffsetX = panelIndex * PANEL_WIDTH  // X 偏移
```

这意味着用有限的配置模板，可以无限扩展地图。

### 7.2 按需加载

不是所有地块都在入场时加载。初始只加载已有数据的地块，其余加入「待加载队列」。角色移动时检测是否接近未加载区域：

```javascript
// 角色位置 ± 缓冲区与地块包围盒做 AABB 碰撞检测
if (charX + buffer >= area.minX && charX - buffer <= area.maxX &&
    charY + buffer >= area.minY && charY - buffer <= area.maxY) {
  loadArea(area)
}
```

触发加载后，并行请求地块数据和配置，返回后增量合并到已有数据中。

### 7.3 增量构建的幂等性

`buildMapData` 方法通过 `_builtBlocks` Set 追踪已构建的地块，确保：

- 新地块只构建一次，不重复处理
- 地块从「未激活」→「已激活」时，自动移除旧的标记物及其碰撞盒，替换为可交互元素
- 全量重建障碍物网格只在必要时触发（低频操作，成本可接受）

```javascript
for (const key of Object.keys(areaBlocksCache)) {
  if (this._builtBlocks.has(key)) continue  // 已构建，跳过
  this._builtBlocks.add(key)
  // ... 构建该地块的元素、装饰物、碰撞盒
}
```

---

## 八、setData 性能极限优化

这是整篇文章的核心。在小程序双线程架构下，setData 是唯一的数据传输通道，也是最大的瓶颈。

### 8.1 合批策略

一帧内可能需要更新：角色坐标、镜头偏移、角色 z-index、可见元素列表、气泡状态。如果分 5 次 setData，就是 5 次跨线程通信。

解法：累积到一个对象中，最后一次 setData：

```javascript
moveCharacter() {
  // ... 碰撞检测、位移计算 ...

  const setObj = this._calcCameraSetObj()  // charX, charY, offsetX, offsetY

  if (this.data.showBubble) {
    setObj.showBubble = false
  }

  const charZIndex = calcZIndex(newY)
  if (charZIndex !== this.data.charZIndex) {
    setObj.charZIndex = charZIndex
  }

  // 可见列表按策略降频
  if (shouldRefresh) {
    Object.assign(setObj, this._calcVisibleData())
  }

  this.setData(setObj)  // 整帧只有这一次
}
```

### 8.2 精简传输字段

可交互元素的完整数据可能有 20+ 个字段（名称、描述、来源、时间等），但渲染只需要 7 个（坐标、尺寸、图片 URL、层级、动画状态）。

```javascript
// 推送给 view 层的精简对象
visibleItems.push({
  id: f.id,
  x: f.x, y: f.y, w: f.w, h: f.h,
  img: f.img,
  zIndex: f.zIndex,
  appeared: animated,
})

// 点击时从 Map 中按需还原完整数据
onItemTap(e) {
  const fullData = this._itemById.get(e.currentTarget.dataset.id)
}
```

这一项就减少了约 40% 的 setData 数据量。

### 8.3 移动冻结

如第三章所述，移动过程中完全不刷新可见列表，只推送 5 个数字。这是最激进也最有效的优化：

```javascript
// moveCharacter 中：
const setObj = this._calcCameraSetObj()  // 只有 charX, charY, offsetX, offsetY, charZIndex
this.setData(setObj)

// onJoystickEnd 中（松手时）：
this.updateVisibleNodes()  // 补一次完整刷新
```

### 8.4 复用数组消除 GC

JavaScript 的垃圾回收（GC）在低端机上可能造成 10~30ms 的卡顿。高频路径中避免创建临时对象：

```javascript
// ❌ 每帧创建新数组
function query() {
  const result = []
  // ... push ...
  return result
}

// ✅ 复用预分配数组
function query(scratch) {
  scratch.length = 0
  // ... push ...
  return scratch
}
```

碰撞检测和视窗查询都使用这种 scratch 模式。

### 8.5 帧率与节流的权衡

| | 16ms (60fps) | 32ms (30fps) |
|---|---|---|
| iOS / 高端 Android | ✅ 流畅 | 无必要 |
| 鸿蒙 / 低端 Android | ❌ setData 通信占满帧间隔，持续丢帧 | ✅ 每帧留出足够余量 |
| 角色移动速度 | 6 rpx/帧 | 10 rpx/帧（提速保持体感一致）|

在多机型适配场景下，32ms 是一个更稳健的选择。如果需要动态适配，可以在入场时跑几帧空循环测量实际帧耗时，自动选择节流档位。

---

## 九、动画体系与性能取舍

### 9.1 出场动画

元素首次进入视窗时播放弹出动画（scale + opacity），通过 `animation-delay` 实现交错效果：

```css
.item {
  opacity: 0;
  transform: scale(0.3) translateY(20rpx);
  animation: itemAppear 0.6s ease-out forwards;
}

@keyframes itemAppear {
  0%   { opacity: 0; transform: scale(0.3) translateY(20rpx); }
  60%  { opacity: 1; transform: scale(1.08) translateY(-4rpx); }
  100% { opacity: 1; transform: scale(1) translateY(0); }
}
```

每个元素的 `animation-delay` 按进入视窗的顺序递增 0.05s，形成「依次冒出」的视觉效果。动画结束后切换为 `--static` 类名，移除 animation 避免持续 GPU 开销。

### 9.2 碰撞反馈：粒子飞散

角色碰到可交互元素时触发粒子特效。每片粒子的运动轨迹由 CSS 变量驱动：

```html
<view class="petal"
  style="left:{{x}}rpx; top:{{y}}rpx; --end-x:{{endX}}rpx; --end-y:{{endY}}rpx;">
```

```css
@keyframes petalMove {
  0%   { transform: translate(0, 0); }
  100% { transform: translate(var(--end-x), var(--end-y)); }
}
```

粒子数量控制在 3~5 片，1.12 秒后通过延时器清除节点。

### 9.3 无限循环动画的代价

一个容易踩的坑：给每个可见元素添加 `animation: sway 3s infinite` 微摇动画。看起来很自然，但 50~100 个元素 = 50~100 个独立 CSS 动画同时运行，GPU 合成线程压力巨大。

降级策略：
- **方案 A**：元素进入视窗时摇 3 秒，之后静止（一次性动画）
- **方案 B**：角色移动时暂停摇摆，静止时恢复
- **方案 C**：直接去掉，保留出场动画即可

实测方案 C 对视觉丰富度的影响极小（元素密度和颜色多样性是主要视觉来源），但 GPU 负载降低 60%+。

---

## 十、总结与反思

### 小程序做重交互的边界在哪

经过这个项目，我的结论是：**小程序可以做 2D 跑图，但有明确的天花板**。

| 能做到 | 做不到 |
|--------|--------|
| 大地图自由漫游 | 60fps 在所有机型上稳定（鸿蒙极限约 30fps）|
| 数百个可交互节点 | 上千节点同屏（虚拟滚动后同屏约 100~180 个）|
| 碰撞检测 + 滑墙 | 复杂物理模拟（刚体、弹性碰撞）|
| 粒子特效 | 大量粒子（CSS 动画数量有上限）|
| 点击交互 + 原生弹窗 | Canvas 混合渲染（层级问题）|

### 技术优化 vs 产品减法

一个重要的认知：**技术优化解决的是「如何高效地渲染」，但「要渲染多少东西」是产品决策**。

当技术手段到达天花板时（合批 setData、虚拟滚动、空间索引、GPU 加速都已落地），进一步的性能提升必须依靠产品侧的取舍——比如限制同屏元素数量、降级远处元素的展示精度、减少无限循环动画等。

这不是推卸责任，而是让正确的角色做正确的决策。

### 可复用的通用方案清单

从这个项目中沉淀出的可复用方案：

1. **空间网格索引** — 适用于任何需要「查询附近元素」的场景
2. **scratch 数组复用** — 高频路径消除 GC 的通用模式
3. **合批 setData** — 单帧累积所有变更后一次推送
4. **虚拟滚动 + AABB 裁剪** — 大量节点的通用渲染优化
5. **Wall Sliding 三层降级** — 2D 碰撞响应的完整方案
6. **translate3d 镜头** — 零重排的视窗平移
7. **queryTag 跨格去重** — 空间索引的标准去重技巧
8. **增量构建幂等** — 动态加载场景下的数据合并范式

这些方案不依赖具体业务，可以直接迁移到任何小程序中的地图、长列表、游戏化场景。
