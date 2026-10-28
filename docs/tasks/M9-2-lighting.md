# M9-2 任务卡：光影与视野（火把光晕 + FOV 软边渐变 + 暗角）

> 阶段：S4 精修像素期（PLAN.md §16.6 A-3 项）
> 目标：火把光晕（动态光感）、FOV 视野边缘柔和渐变（非硬切）、画面暗角氛围
> 打磨上限：2-3 遍（判据是 PASS，不是遍数）

## 一、背景

M9-1 已加入细节 tile 与装饰物（含静态火把）。本任务给画面补"光"：火把格发出径向光晕、FOV 视野边缘从可见到迷雾平滑过渡、四角加暗角（vignette）——SPD 氛围感的三个关键来源。

## 二、契约（纯新增，不改既有接口）

新增 `js/systems/lighting.js`（IIFE + `window.Game`，风格与 fov.js/hud.js 一致）：

```
Game.Lighting = {
  init: function (),              // 预创建径向渐变（性能：避免每帧 new 渐变）
  draw: function (),              // 叠加光晕 + 软边 + 暗角（render.js 每帧调用，在 FOV 遮罩之后、HUD 之前）
  setRadius: function (r),        // 软边过渡半径（默认 2 格），M9-5 设置面板可调
  _debug: { enabled, mode }       // 调试辅助（可选）
};
```

- **火把光晕**：遍历 `Game.Systems.Map.getDecor` 为 `torch` 的可见格，在格中心画径向渐变（暖橙 `rgba(255,170,60,α)` 中心亮到透明），α 随距离衰减；同屏光晕数上限（如 12）防性能。
- **FOV 软边**：基于 `Game.fov.isVisible/isExplored`（S3-1 接口），在可见区边缘 1-2 格做 alpha 渐降遮罩（可见→半可见→迷雾黑），替代现 S3-1 的硬切全黑；被探索记忆格保持 M9-1 的暗色记忆态。
- **暗角**：画布四角径向渐变压暗（`rgba(0,0,0,0.25)` → 透明），中心不遮。
- **层级**：Lighting.draw 在 render.js 的 `drawMap`（含迷雾）之后、`_drawHud` 之前；弹窗打开时照明照常（弹窗叠其上）。

## 三、文件范围

| 文件 | 动作 |
|---|---|
| `js/systems/lighting.js` | **新增**：光晕/软边/暗角绘制 |
| `js/core/render.js` | 修改：`drawMap` 后调用 `Game.Lighting.draw()`（try/catch 兜底） |
| `index.html` | 修改：`lighting.js` 插入 systems 组（`feedback.js` 之后、`quest.js` 之前） |
| `js/systems/fov.js` | 修改（只加只读辅助，不改既有契约）：暴露 `isVisible/isExplored` 已有能力即可，如需边缘距离查询新增 `distanceToPlayer(x,y)`（纯新增函数，不改 compute 语义） |
| `README.md` | 修改：功能列表补充"火把光影/视野软边/暗角" |
| `preflight/verify_m9_2.html` | **新增**：R-01 模板验证页 |

## 四、硬性约束

- 原生 JS + Canvas 零构建；file:// 双击 index.html 可玩；不引入 npm/构建工具/付费资源。
- 不改 `window.Game` 既有接口与事件频道；Lighting 为纯新增。
- **性能优先**：渐变对象 init 预建、每帧复用；光晕上限防刷屏；60fps 为验收线。
- 软边不得改变 FOV 可见性语义（`isVisible` 仍决定怪/物是否绘制），只做视觉 alpha 过渡。
- 火把只在玩家可见范围内发光（迷雾外的火把不画光晕）。

## 五、完成标准

1. 列出改动文件清单（文件 + 行数概览）。
2. 用下方验证命令跑 `preflight/verify_m9_2.html`，输出必须出现 `lightLoaded:true`、`lightApi:true`、`lightOk:true`。
3. 说明剩余风险点。
4. 实现不了的直接说卡点与尝试，不绕过不改方案。

## 六、验证命令（Start-Process 方案）

```
$env:PATH="C:\Windows\System32;C:\Windows;$env:PATH"
$edge="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$od="$env:TEMP\m92.out.txt"; $ed="$env:TEMP\m92.err.txt"; $pd="$env:TEMP\edgem92"+(Get-Random)
Start-Process -FilePath $edge -ArgumentList "--headless=new","--disable-gpu","--no-first-run","--user-data-dir=$pd","--virtual-time-budget=3500","--dump-dom","file:///D:/桌面/工作/人工智能大作业/preflight/verify_m9_2.html" -Wait -PassThru -RedirectStandardOutput $od -RedirectStandardError $ed | Out-Null
Get-Content $od -Raw
```

验证页要求（加载 eventBus → render → fov → lighting，与主游戏同序）：
- 模块加载与接口齐备；
- 火把格绘制后其中心像素 alpha > 0（光晕落笔）；
- 软边：模拟边缘格与中心格 alpha 不同（边缘更暗）；
- 暗角：四角像素比中心暗（或 alpha 更高）；
- 重复调用 draw 不抛错（性能稳定）；
- title/body 各出现一次 `PASS {...}`。

## 七、回归要求

- 主游戏 `index.html` headless 冒烟：无 `Uncaught/TypeError/ReferenceError/SyntaxError`。
- S3-1 / S3-2 / S3-3 / S3-4 / M9-1 验证页复跑 PASS（照明层与 FOV/HUD/弹窗/战斗反馈/细节装饰共存）。
