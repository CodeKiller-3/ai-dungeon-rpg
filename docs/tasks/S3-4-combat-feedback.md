# S3-4 任务卡：战斗反馈（伤害数字飘字 + 受击动画）

> 阶段：S3 界面定稿第 4 步（S3-1 FOV ✅ → S3-2 HUD ✅ → S3-3 弹窗 ✅ → **S3-4 战斗反馈** → S3 定稿完成）
> 参考基准：Shattered Pixel Dungeon 战斗反馈（命中伤害数字上飘渐隐、怪物受击闪白/抖动、玩家受击红闪）
> 打磨上限：2-3 遍（判据是 PASS，不是遍数）

## 一、背景

现有回合制战斗（`js/systems/battle.js`）通过 `battle:start/battle:end` 频道和文字日志推进，**没有视觉反馈**：攻击命中不显示伤害数值、怪物受击无动画。本任务补上三层视觉反馈，提升打击感（对应 §17 参考执行计划路线 A 的"战斗加伤害数字飘字+怪物受击动画"）。

## 二、契约（纯新增，不改既有接口与频道）

新增 `js/systems/feedback.js`（IIFE + `window.Game`，风格与 fov.js/hud.js/modal.js 一致）：

```
Game.Feedback = {
  spawn: function (opts),   // opts: { x, y, text, color, life, vy } 飘字；{ x, y, kind: 'hit'|'hurt', life } 受击闪白/抖动
  update: function (dt),    // 推进生命周期与位移（main.js 每帧调用）
  draw: function ()         // 绘制全部存活反馈（render.js 每帧调用）
};
```

- **订阅（不新增频道，避免改既有契约）**：复用现有频道携带的信息即可；若现有频道缺数值，由 `spawn` 调用方（battle.js 内 damage 处）直接构造，不修改频道 payload。
- 反馈类型：
  1. **伤害飘字**：`text` 为伤害值（如 `-12`），从命中点向上飘 20-30px 渐隐，500-700ms 生命周期，白色/红色区分敌我。
  2. **怪物受击**：命中瞬间该怪物 sprite 闪白（叠加白色 alpha 0.7，2-3 帧）或水平抖动（±2px，100ms）。
  3. **玩家受击**：玩家 sprite 红色闪动 + 屏幕边缘轻微红晕（可选，低强度）。
- 数据源：`Game.Systems.Battle.getState()`（返回 state，含 monster 与战斗状态）与 `Game.Data.Player`；飘字坐标取自怪物/玩家绘制位置（render.js 现有坐标计算，反馈层只拿坐标，不重算地图）。

## 三、文件范围

| 文件 | 动作 |
|---|---|
| `js/systems/feedback.js` | **新增**：Feedback 状态数组 + spawn/update/draw |
| `js/systems/battle.js` | 修改：`playerAction('attack')` 命中与 `monsterTurn` 命中处调用 `Game.Feedback.spawn(...)`（伤害值/位置/敌我类型），不改变任何战斗数值与既有 emit |
| `index.html` | 修改：`feedback.js` 插入 systems 组（`modal.js` 之后、`quest.js` 之前） |
| `js/core/render.js` | 修改：`drawBattle` 后追加 `Game.Feedback.draw()`；怪物/玩家绘制处不强制改（若闪白用 drawImage 叠加，可在 Feedback.draw 内用状态快照重绘，二选一，保持零构建） |
| `js/core/main.js` | 修改：主循环内调用 `Game.Feedback.update(dt)`（与 syncHud 并列位置） |
| `README.md` | 修改：功能列表补充战斗反馈（伤害飘字/受击动画） |
| `preflight/verify_s3_4.html` | **新增**：R-01 模板验证页 |

## 四、硬性约束

- 原生 JS + Canvas 零构建；file:// 双击 index.html 可玩；不引入 npm/构建工具/付费资源。
- 不改 `window.Game` 既有接口、事件频道与战斗数值（伤害公式、胜负判定、金币经验一律不动）。
- 飘字中文/数字不溢出画布；不依赖额外字体（用 canvas 默认字体，数字为主）。
- 每帧反馈数量有上限（同屏 ≤ 20 条，超出丢弃最旧），防刷屏性能问题。

## 五、完成标准

1. 列出改动文件清单（文件 + 行数概览）。
2. 用下方验证命令跑 `preflight/verify_s3_4.html`，输出必须出现 `fbLoaded:true`、`fbApi:true`、`fbOk:true`。
3. 说明剩余风险点。
4. 实现不了的直接说卡点与尝试，不绕过不改方案。

## 六、验证命令（Start-Process 方案，本机已确认可靠）

```
$env:PATH="C:\Windows\System32;C:\Windows;$env:PATH"
$edge="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$od="$env:TEMP\s34.out.txt"; $ed="$env:TEMP\s34.err.txt"; $pd="$env:TEMP\edge34"+(Get-Random)
Start-Process -FilePath $edge -ArgumentList "--headless=new","--disable-gpu","--no-first-run","--user-data-dir=$pd","--virtual-time-budget=3500","--dump-dom","file:///D:/桌面/工作/人工智能大作业/preflight/verify_s3_4.html" -Wait -PassThru -RedirectStandardOutput $od -RedirectStandardError $ed | Out-Null
Get-Content $od -Raw
```

验证页要求：加载 eventBus → render → feedback（与主游戏同序），断言：
- `spawn` 后反馈数组非空、`update` 推进生命周期、`draw` 落笔像素变化、到期条目被清理；
- title/body 各出现一次 `PASS {...}`。

## 七、回归要求

- 主游戏 `index.html` headless 冒烟：无 `Uncaught/TypeError/ReferenceError/SyntaxError`。
- S3-1 / S3-2 / S3-3 验证页复跑 PASS（反馈层与 FOV、HUD、弹窗共存，互不干扰）。
