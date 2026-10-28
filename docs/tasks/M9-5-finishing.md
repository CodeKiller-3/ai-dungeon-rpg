# M9-5 任务卡：性能与收尾（DPR 高清适配 + 窄窗口 + 性能审计 + 死亡结算 + 首次引导 + 空状态）

> 阶段：S4 精修像素期收尾（PLAN.md §16.6 B/C 档 / M9-5）
> 目标：高分屏清晰（DPR）、窄窗口不截断、60fps 审计、死亡有结算、新玩家有引导、空状态不白屏
> 打磨上限：3-4 遍（判据是 PASS，不是遍数）

## 一、背景

S4 精修像素四步（M9-1 细节 / M9-2 光影 / M9-3 动画 / M9-4 音效）已完成。本任务收尾技术债与体验闭环：DPR 高清、窄窗口、性能、死亡结算、首次引导、空状态。

## 二、契约（按项说明）

### 2.1 DPR 高清适配（render.js / main.js）

- 画布按 `devicePixelRatio` 缩放：`canvas.width = cssWidth * dpr`（上限 2，防高 DPR 设备过载）；所有绘图坐标/字号按 dpr 换算或 `ctx.setTransform(dpr,0,0,dpr,0,0)`。
- **约束**：不改任何绘制函数的坐标语义（用 setTransform 统一缩放，最小侵入）；弹窗/验证页读取的 canvas.width/height 变化不影响逻辑坐标（逻辑格坐标与 TILE 不变）。

### 2.2 窄窗口适配（render.js / css）

- 窗口 <520px 宽时：HUD/底部提示行改用紧凑版（字号/边距缩小），地图相机适配；不横向溢出。
- 原 S3-2 风险点 6（底部提示行 <~520px 截断）在本任务一并解决。

### 2.3 性能审计（新增 `preflight/verify_m9_5.html` 断言 + 主游戏审计）

- 渲染循环 100 帧耗时采样：平均单帧 < 16.7ms（60fps 线，宽松 20ms）；
- 内存/对象审计：连续生成 5 层地图无累积对象泄漏（粒子/消散列表/运动条目不增长）——用 `Game.Particles.count()`、`Game.Motion.clear` 后计数归零断言；
- 事件监听器不重复注册（重复 init 后监听数不翻倍）。

### 2.4 死亡结算（main.js / battle.js / modal）

- 玩家死亡（HP≤0）时：现有死亡处理升级为**结算弹窗**——展示"本局战绩"（到达楼层/击杀数/获得金币/用时，取现有 Game.Data.Player 字段与 HUD 计数，不新增数值系统）、两个按钮：重新开始（重置本局，走既有 resetPlayer/resetMap 逻辑）、返回标题（若已有标题画面则接入，否则只保留重新开始并注明）。
- 复用 Modal kind 'gameover'；战绩文案字段必须真实来自现有状态，不杜撰。

### 2.5 首次引导（main.js + 轻量覆盖层）

- 首次启动（无存档/无 localstorage 标记）显示一屏引导：操作按键（方向键/WASD 移动、空格攻击、B 背包、S 商店、M 任务、T 对话、L 强化学习、K 静音、Q 设置、Esc 关闭——与 M9-4 设置面板文案一致，取自现有实现）、目标（"探索地牢、击杀怪物、层层深入"）。
- 任意键/点击关闭；localStorage 键 `aiDungeon_guided` 标记已引导（浏览器禁用存储则每局显示，降级可接受）。

### 2.6 空状态（modal / inventory / quests）

- 背包空：面板显示"背包空空如也"（现 UI 若已显示 0 项列表则补一行提示）；
- 任务空：显示"暂无任务"；商店货架空不适用（货架固定 3 项，跳过）；
- 为空提示不破坏弹窗布局（居中一行灰字）。

## 三、文件范围

| 文件 | 动作 |
|---|---|
| `js/core/render.js` | 修改：DPR setTransform；窄窗口紧凑绘制 |
| `js/core/main.js` | 修改：死亡结算弹窗触发；首次引导覆盖层；resize 处理 |
| `js/systems/modal.js` | 修改：新增 'gameover' kind；空状态文案 |
| `js/systems/inventory.js` / `quest.js` | 修改（如已显示 0 项则补空状态行，最小改动） |
| `index.html` | 修改：引导层 DOM（或画布内绘制，选实现成本低者） |
| `css/style.css` | 修改：窄窗口媒体查询 |
| `README.md` | 修改：功能列表补充 DPR/引导/死亡结算/空状态 |
| `preflight/verify_m9_5.html` | **新增**：R-01 模板验证页 |

## 四、硬性约束

- 原生 JS + Canvas 零构建；file:// 双击 index.html 可玩；不引入 npm/构建工具/付费资源。
- DPR 用 setTransform 统一缩放，**不改绘制坐标语义与逻辑格坐标**；TILE 不变。
- 死亡战绩字段只取现有状态（Player/HUD 计数），不新增数值系统。
- 首次引导文案按键必须与 M9-4 设置面板一致（同源）。
- 全部新增能力静默降级：无 localStorage / 极窄窗口 / 低性能设备均不报错。

## 五、完成标准

1. 列出改动文件清单（文件 + 行数概览）。
2. 用下方验证命令跑 `preflight/verify_m9_5.html`，输出必须出现 `finLoaded:true`、`finApi:true`、`finOk:true`。
3. 说明剩余风险点。
4. 实现不了的直接说卡点与尝试，不绕过不改方案。

## 六、验证命令（Start-Process 方案）

```
$env:PATH="C:\Windows\System32;C:\Windows;$env:PATH"
$edge="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$od="$env:TEMP\m95.out.txt"; $ed="$env:TEMP\m95.err.txt"; $pd="$env:TEMP\edgem95"+(Get-Random)
Start-Process -FilePath $edge -ArgumentList "--headless=new","--disable-gpu","--no-first-run","--user-data-dir=$pd","--virtual-time-budget=3500","--dump-dom","file:///D:/桌面/工作/人工智能大作业/preflight/verify_m9_5.html" -Wait -PassThru -RedirectStandardOutput $od -RedirectStandardError $ed | Out-Null
Get-Content $od -Raw
```

验证页要求（加载顺序与主游戏一致，DPR 用可注入的 dpr 值断言而非依赖真实显示器）：
- 模块加载与接口齐备；
- DPR：注入 dpr=2 后 `canvas.width === cssWidth*2`（上限 2 钳制），`setTransform` 生效（getTransform 主缩放=2）；dpr=1 时无变化；
- 窄窗口：模拟窄宽后关键绘制函数不抛错（无法真测像素时断言函数可调 + 布局参数返回合理值）；
- 性能：合成 100 帧 drawMap 平均耗时 < 20ms（headless 环境宽松线；仅测无异常与数量级）；
- 死亡结算：触发 `open('gameover')` 后 current 正确、战绩字段来自 Player/HUD 状态、重新开始按钮回调重置状态；
- 首次引导：无标记时 `needsGuide()===true`、调用后写标记；有标记时 false；
- 空状态：背包/任务 0 项时弹窗绘制不抛错；
- title/body 各出现一次 `PASS {...}`。

## 七、回归要求

- 主游戏 `index.html` headless 冒烟：无 `Uncaught/TypeError/ReferenceError/SyntaxError`。
- S3-1 / S3-2 / S3-3 / S3-4 / M9-1 / M9-2 / M9-3 / M9-4 验证页复跑 PASS。
