# 小程序 Canvas 2D 实现超长帧动画循环播放

## 背景

需求是在小程序中循环播放一段 **400 帧** 的动画（25fps，约 16 秒一轮）。拿到设计稿时觉得不难——不就是逐帧播放吗？但真正动手后发现坑比想象的多：

1. **单张图放不下**。400 帧横排 = 150000px 宽，微信小程序 Canvas 有个硬限制：**任意边超过 4096px 的图片加载失败**（Android 必现，iOS 不稳定）。必须拆成多张小图。
2. **40 张图全加载太慢**。拆成 40 张后总计约 8MB，全加载完才播放用户要等很久。
3. **setData 方案不可行**。400 帧 × 每帧 setData 一次 background-position？在双线程架构下直接卡死。
4. **CSS animation 切雪碧图闪烁**。单张雪碧图内可以用 `steps()` 流畅播放，但切换到下一张时有明显闪烁。

最终方案：**Canvas 2D + requestAnimationFrame + 雪碧图分批加载**。

---

## 核心方案

### 架构总览

```
组件挂载
  ├─ prepareSpriteUrls()        准备 40 张雪碧图 URL
  ├─ initCanvas()               初始化 Canvas（含重试）
  └─ loadSpriteImages(4)        首批加载 4 张（40帧），后台加载剩余 36 张

播放时
  └─ startAnimation()
       └─ canvas.requestAnimationFrame(animate)
            ├─ 帧率控制（时间差 ≥ 40ms 才绘制）
            ├─ 计算当前帧 → 定位到第几张图的第几帧
            ├─ ctx.drawImage(裁剪源区域 → 绘制到画布)
            └─ currentFrame = (currentFrame + 1) % 400（循环）
```

### 雪碧图切片策略

基于 4096px 限制推导：

```
单帧尺寸：375 × 812px
每张横排最大帧数 = floor(4096 / 375) = 10 帧
每张雪碧图尺寸 = 3750 × 812px ✅（均 < 4096）
总共需要 = ceil(400 / 10) = 40 张
```

### 分批加载：首批优先 + 后台渐进

```javascript
async loadSpriteImages(minLoadCount = 4) {
  // Step 1: 先加载前 4 张（40 帧 ≈ 1.6 秒动画），保证快速启动
  const firstBatch = spriteUrls.slice(0, minLoadCount)
  await Promise.all(firstBatch.map((url, i) => loadImage(url, i)))

  // Step 2: 剩余 36 张在后台异步加载，不阻塞播放
  spriteUrls.slice(minLoadCount).forEach((url, i) => {
    loadImage(url, i + minLoadCount)
  })
}
```

动画循环中，如果当前帧对应的雪碧图尚未加载完成，跳过该帧绘制（画布保持上一帧），不中断循环。用户感知上最多是前几秒动画"卡了一下"，后续全部流畅。

### 动画循环核心

```javascript
startAnimation() {
  const fps = 25
  const frameInterval = 1000 / fps
  let lastTime = Date.now()
  let currentFrame = 0

  const animate = () => {
    if (!this.animationFrameId) return
    if (this.data.isPaused) {
      this.animationFrameId = canvas.requestAnimationFrame(animate)
      return
    }

    const now = Date.now()
    if (now - lastTime >= frameInterval) {
      lastTime = now - ((now - lastTime) % frameInterval)

      const spriteIndex = Math.floor(currentFrame / 10)
      const frameIndex = currentFrame % 10
      const img = this.spriteImages[spriteIndex]

      ctx.clearRect(0, 0, width, height)
      if (img) {
        ctx.drawImage(
          img,
          frameIndex * frameWidth, 0, frameWidth, frameHeight,  // 源裁剪
          dx, dy, targetWidth, targetHeight                      // 目标绘制
        )
      }

      currentFrame = (currentFrame + 1) % totalFrames  // 循环
    }

    this.animationFrameId = canvas.requestAnimationFrame(animate)
  }

  this.animationFrameId = canvas.requestAnimationFrame(animate)
}
```

关键点：
- **用 Canvas 实例的 RAF**（`canvas.requestAnimationFrame`），而非全局 `setTimeout`/`setInterval`
- **时间差控帧率**：避免 RAF 回调频率 > 目标帧率时过度绘制
- **取模循环**：`currentFrame % totalFrames` 实现无缝循环
- **暂停不退出循环**：保持 RAF 运转但跳过绘制，恢复时零延迟

---

## Canvas 初始化的坑

Canvas 节点在组件刚挂载时可能拿不到（渲染层还没准备好），需要重试：

```javascript
async initCanvas() {
  let canvas = null
  let retryCount = 0

  while (!canvas && retryCount < 5) {
    if (retryCount > 0) await sleep(100 * retryCount)  // 指数退避
    const res = await queryCanvas('#animationCanvas')
    canvas = res?.node
    retryCount++
  }

  if (!canvas) return false

  const ctx = canvas.getContext('2d')
  const dpr = wx.getSystemInfoSync().pixelRatio || 2

  // 设置物理像素尺寸（避免模糊）
  canvas.width = logicalWidth * dpr
  canvas.height = logicalHeight * dpr
  ctx.scale(dpr, dpr)

  this.canvasInfo = { canvas, ctx, width: logicalWidth, height: logicalHeight }
  return true
}
```

---

## 资源管理

```javascript
lifetimes: {
  attached() {
    // 挂载即预加载，不等用户触发
    this.prepareSpriteUrls()
    this.preloadSprites()
  },
  detached() {
    // 销毁时彻底清理
    this.stopAnimation()
    this.spriteImages = null
    this.canvasInfo = null
  }
}
```

---

## 方案对比

| 方案 | 帧数上限 | 流畅度 | 交互能力 | 适用场景 |
|------|:---:|:---:|:---:|---------|
| CSS animation + steps() | ~50 帧（单张雪碧图） | ✅ | ❌ 无暂停/进度控制 | 简短循环动画 |
| setData + background-position | ~30 帧 | ❌ 卡顿 | ✅ | 极简场景 |
| Lottie | 取决于复杂度 | ✅ | ⚠️ 有限 | 矢量动画 |
| **Canvas 2D + RAF** | **无限** | **✅** | **✅ 暂停/恢复/跳帧** | **超长帧动画 ✅** |

---

## 可复用结论

1. **4096px 是硬限制**。小程序 Canvas 加载图片时，任意边超过 4096px 在 Android 上必定失败。设计雪碧图时每张宽高都必须 < 4096px。
2. **首批优先加载**。不需要等全部资源就绪才开始播放，先加载足够维持前几秒的帧数，剩余后台渐进加载。
3. **用时间差控帧率，不用 setInterval**。RAF 回调频率不固定（60fps/30fps 取决于设备），必须用 `elapsed >= frameInterval` 判断是否该绘制下一帧。
4. **暂停 ≠ 停止循环**。暂停时保持 RAF 运转但跳过绘制，恢复时立即响应，无需重新启动动画。
5. **Canvas 节点获取需重试**。组件 attached 时 Canvas 可能还没渲染好，用指数退避重试。
6. **dpr 必须处理**。`canvas.width = 逻辑宽 × dpr` + `ctx.scale(dpr, dpr)`，否则在高清屏上模糊。
