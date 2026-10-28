# M9-3 任务卡：动画与手感（移动平滑插值 + 怪物死亡消散 + 攻击前摇 + 粒子特效）

> 阶段：S4 精修像素期（PLAN.md §16.6 A-4 项）
> 目标：格子瞬移变滑动、死亡有消散、攻击有前摇、关键动作有粒子——"手感"三件套 + 粒子
> 打磨上限：3-4 遍（判据是 PASS，不是遍数）

## 一、背景

M9-1/M9-2 已补地图细节与光影。当前玩家/怪物移动是"格子瞬移"、死亡直接消失、攻击无动作帧——SPD 的"手感"核心未到。本任务在**不改变逻辑层位置语义**的前提下，把渲染层动画补齐。

## 二、契约（纯新增渲染层，逻辑语义不变）

### 2.1 移动平滑插值（新增 `js/systems/motion.js`）

```
Game.Motion = {
  setStep: function (entityId, fromX, fromY, toX, toY, durationMs),  // 登记一次格子间移动
  getRenderPos: function (entityId) -> {x, y, t},                    // 返回插值后的渲染坐标（画布/世界坐标均可，由调用方换算）
  update: function (dtMs),                                           // 推进插值计时
  clear: function ()
};
```

- **逻辑层不动**：`Game.Systems.Map` / 怪物的逻辑坐标、`Game.fov` 视野计算、碰撞判定全部仍用格子坐标；`getRenderPos` 只给渲染层取"视觉位置"。
- 插值：`t = clamp(elapsed / duration, 0, 1)`，位置 = `from + (to - from) * t`（线性；可加 2 格缓出 easing，简单 easeOutQuad）。
- 玩家与巡逻怪统一走 Motion；战斗内的玩家/怪（battle 场景 sprite 已有固定站位）不接入。
- 未登记移动的实体 `getRenderPos` 返回其逻辑位置（降级兼容）。

### 2.2 怪物死亡消散（battle.js + render.js 接入）

- battle 中怪物死亡（含玩家击杀）：该怪标记 `dying` 状态（状态机：alive → dying(600-800ms 渐隐+上浮+缩小) → gone 并从渲染移除）。
- `battle.js` 只负责把死亡怪从"战斗列表"移到"消散列表"并标 `dyingAt`；消散动画由渲染层/粒子系统完成。
- 消散期间不再参与任何战斗判定。

### 2.3 攻击前摇（battle.js 渲染帧）

- 玩家/怪物攻击动作：蓄力帧（sprite 后拉 1-2 帧）→ 出手帧 → 恢复帧，总时长约 250-400ms。
- 用状态字段（`action:'attack', actionAt`）驱动，不阻塞战斗结算逻辑（结算仍即时，前摇纯视觉）。

### 2.4 粒子特效（新增 `js/systems/particles.js`）

```
Game.Particles = {
  spawn: function (kind, x, y, opts),   // kind: 'spark'|'puff'|'shard'|'soul'（死亡灵魂上浮）
  update: function (dtMs),
  draw: function (),                    // render.js 每帧调用
  count: function ()                    // 当前粒子数（调试/验证用）
};
```

- 触发点：命中火花（攻击命中）、死亡消散（shard/soul）、宝箱开启（gold spark）——只接已有事件点，不新增游戏规则。
- 上限 60 粒/屏，到期自动回收；`update` 推进位置/alpha/缩放。
- 低端兜底：`Particles.enabled=false` 时全部静默（性能开关，M9-5 设置面板可调）。

## 三、文件范围

| 文件 | 动作 |
|---|---|
| `js/systems/motion.js` | **新增**：插值状态机 |
| `js/systems/particles.js` | **新增**：粒子系统 |
| `js/core/render.js` | 修改：`drawMap`（或实体绘制处）用 `Motion.getRenderPos` 取玩家/巡逻怪位置；接入粒子 `draw`；死亡怪渐隐绘制 |
| `js/systems/battle.js` | 修改：死亡怪转消散列表；攻击动作帧状态；命中处 `Particles.spawn` |
| `js/core/main.js` | 修改：`loop` 调 `Motion.update(dt)` / `Particles.update(dt)`；移动登记（玩家移动时 `Motion.setStep`） |
| `index.html` | 修改：`motion.js`/`particles.js` 插入 systems 组（`lighting.js` 之后、`quest.js` 之前） |
| `README.md` | 修改：功能列表补充"移动平滑/死亡消散/攻击前摇/粒子" |
| `preflight/verify_m9_3.html` | **新增**：R-01 模板验证页 |

## 四、硬性约束

- 原生 JS + Canvas 零构建；file:// 双击 index.html 可玩；不引入 npm/构建工具/付费资源。
- **逻辑层零改动**：移动/碰撞/FOV/战斗结算语义不变，Motion/Particles 纯新增渲染层。
- 性能：插值仅对屏幕内实体；粒子上限 60；60fps 验收线；`Particles.enabled` 提供低端开关。
- 攻击前摇不阻塞结算：视觉动作与逻辑结算解耦（可先结算、动画后放）。

## 五、完成标准

1. 列出改动文件清单（文件 + 行数概览）。
2. 用下方验证命令跑 `preflight/verify_m9_3.html`，输出必须出现 `motionLoaded:true`、`motionApi:true`、`motionOk:true`。
3. 说明剩余风险点。
4. 实现不了的直接说卡点与尝试，不绕过不改方案。

## 六、验证命令（Start-Process 方案）

```
$env:PATH="C:\Windows\System32;C:\Windows;$env:PATH"
$edge="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$od="$env:TEMP\m93.out.txt"; $ed="$env:TEMP\m93.err.txt"; $pd="$env:TEMP\edgem93"+(Get-Random)
Start-Process -FilePath $edge -ArgumentList "--headless=new","--disable-gpu","--no-first-run","--user-data-dir=$pd","--virtual-time-budget=3500","--dump-dom","file:///D:/桌面/工作/人工智能大作业/preflight/verify_m9_3.html" -Wait -PassThru -RedirectStandardOutput $od -RedirectStandardError $ed | Out-Null
Get-Content $od -Raw
```

验证页要求（加载 eventBus → maps → render → motion → particles → battle，与主游戏同序）：
- 模块加载与接口齐备；
- Motion：`setStep` 后 `t=0` 位置=起点、`t=1`（update 足量）位置=终点、中途在两点之间（easeOutQuad 单调递增）；未登记实体降级返回逻辑位置；
- Particles：`spawn` 后 count 增加、`update` 推进位置/alpha、到期后自动回收（count 归零）、上限 60 不超；
- 死亡消散：构造 dying 状态后 update 推进、完成后从消散列表移除；
- 攻击帧：攻击状态可进入并可推进到恢复帧；
- 重复 update/draw 不抛错；
- title/body 各出现一次 `PASS {...}`。

## 七、回归要求

- 主游戏 `index.html` headless 冒烟：无 `Uncaught/TypeError/ReferenceError/SyntaxError`。
- S3-1 / S3-2 / S3-3 / S3-4 / M9-1 / M9-2 验证页复跑 PASS。
