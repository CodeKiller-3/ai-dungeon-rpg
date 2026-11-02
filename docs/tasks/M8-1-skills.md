# M8-1 任务卡：技能系统（火球 / 冲刺 / 护盾，MP + 冷却）

> 阶段：M8 内容深度（PLAN.md §14.3 / §15.4 M8-1）
> 目标：战斗中可按 4/5/6 释放三个技能；引入真实 MP（解决 HUD"MP 0/0"占位遗留问题）
> 打磨上限：4-6 遍（判据是 PASS，不是遍数）

## 一、背景

战斗目前只有普攻（`battle.playerAction('attack')`）。M9-2 风险点 1 记录：Player 无 mp 字段、HUD MP 条恒空。本任务引入技能系统 + 真实 MP，一并解决遗留占位。

## 二、契约（纯新增 + MP 字段新增，不改既有 attack 语义）

### 2.1 Player schema 扩展（main.js + save.js）

```
player = { ..., hp, maxHp, ... }  +  mp: 50, maxMp: 50
```

- `resetPlayer` 时 `mp = maxMp`；
- **旧存档兼容**：save.js 读取存档时若 `player.mp/maxMp` 缺失，补默认 `{mp:50, maxMp:50}`（不破坏旧档）；
- HUD `syncHud` 传入真实 `mp/mpMax`（替换 M9-2 遗留的固定 0/0）。

### 2.2 技能数据（新增 `js/data/skills.js` 或并入 config，二选一以现有加载序为准）

```
Game.Data.SKILLS = {
  fireball: { name: '火球', key: 4, mpCost: 12, cd: 3, dmg: function(atk){ return Math.round(atk * 1.8); }, desc: '远程火球，1.8×攻击伤害' },
  dash:     { name: '冲刺', key: 5, mpCost: 8,  cd: 2, dmg: function(atk){ return Math.round(atk * 1.2); }, desc: '迅捷突刺，1.2×攻击伤害' },
  shield:   { name: '护盾', key: 6, mpCost: 10, cd: 4, effect: function(p){ return Math.round(p.maxHp * 0.25); }, desc: '抵消 25% 最大生命值的伤害' }
};
```

- 数值全部**可复算公式**（基于 atk/maxHp），不硬编码神秘数字；
- `key` 为战斗场景快捷键（数字键 4/5/6）。

### 2.3 技能运行时（新增 `js/systems/skills.js`）

```
Game.Skills = {
  cast: function (id) -> bool,          // 检查 mp 与冷却 → 扣 mp、设冷却、触发效果；失败 emit ui:notice 说明原因
  getCooldown: function (id) -> number, // 剩余冷却（回合），0=可用
  resetCooldowns: function ()           // 新战斗开始时清零
};
```

- 冷却单位 = **回合**（与回合制一致）：玩家每行动 1 次冷却 -1，最小 0；
- MP 不足 / 冷却中：返回 false 并 emit `ui:notice`（文案含原因，如"MP 不足"），不进入行动序列。

### 2.4 战斗接入（battle.js 扩展，不改 attack 语义）

- `playerAction` 新增命令类型：`'skill:fireball' | 'skill:dash' | 'skill:shield'`（纯新增，`'attack'`/防守逻辑不变）；
- 技能结算：火球/冲刺按 `dmg(atk)` 对怪物造成伤害（走既有伤害-防御公式的倍率版，扣血、飘字、命中粒子、音效复用 S3-4/M9-3 既有通道）；护盾给玩家加临时护盾值（`shieldValue`，存在 battle state，本次战斗内抵挡等量伤害后清零）；
- 释放技能后怪物正常反击（与普攻同节奏）；
- `resetCooldowns` 在 `battle.start` 时调用。

### 2.5 快捷键（main.js）

- 战斗场景中数字键 4/5/6 → `battle.playerAction('skill:fireball'/'skill:dash'/'skill:shield')`；
- 探索场景 4/5/6 无动作（不冲突，保持原按键表不变）。

## 三、文件范围

| 文件 | 动作 |
|---|---|
| `js/data/skills.js`（或并入 config） | **新增**：SKILLS 定义 |
| `js/systems/skills.js` | **新增**：运行时 |
| `js/core/main.js` | 修改：Player 增 mp/maxMp、resetPlayer 恢复、syncHud 传真实 mp、战斗按键 4/5/6 |
| `js/systems/battle.js` | 修改：playerAction 技能命令、护盾值、回合冷却推进、resetCooldowns 钩子 |
| `js/systems/save.js` | 修改：存档读写兼容 mp 字段（缺失补默认） |
| `js/systems/hud.js` | 修改（如需要）：MP 条显示真实值（syncHud 已接则无需改） |
| `index.html` | 修改：skills.js 加载序（data 组内 skills 数据 + systems 组内 skills 运行时） |
| `README.md` | 修改：功能列表补充技能系统；操作说明表加 4/5/6 |
| `preflight/verify_m8_1.html` | **新增**：R-01 模板验证页 |

## 四、硬性约束

- 原生 JS + Canvas 零构建；file:// 双击 index.html 可玩；不引入 npm/构建工具/付费资源。
- **不改** `'attack'` 语义与既有战斗结算接口；技能为纯新增命令类型。
- MP 为新字段：旧存档读取必须兼容（补默认），不破坏现有存档。
- 技能数值全部可复算（公式化），验证页断言数值正确。
- 冷却回合制（行动计数），不引入时间戳计时。

## 五、完成标准

1. 列出改动文件清单（文件 + 行数概览）。
2. 用下方验证命令跑 `preflight/verify_m8_1.html`，输出必须出现 `skillLoaded:true`、`skillApi:true`、`skillOk:true`。
3. 说明剩余风险点。
4. 实现不了的直接说卡点与尝试，不绕过不改方案。

## 六、验证命令（Start-Process 方案）

```
$env:PATH="C:\Windows\System32;C:\Windows;$env:PATH"
$edge="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$od="$env:TEMP\m81.out.txt"; $ed="$env:TEMP\m81.err.txt"; $pd="$env:TEMP\edgem81"+(Get-Random)
Start-Process -FilePath $edge -ArgumentList "--headless=new","--disable-gpu","--no-first-run","--user-data-dir=$pd","--virtual-time-budget=3500","--dump-dom","file:///D:/桌面/工作/人工智能大作业/preflight/verify_m8_1.html" -Wait -PassThru -RedirectStandardOutput $od -RedirectStandardError $ed | Out-Null
Get-Content $od -Raw
```

验证页要求（加载顺序与主游戏一致）：
- 模块加载与接口齐备（Skills.cast/getCooldown/resetCooldowns + SKILLS 数据三技能齐全）；
- **MP**：Player 有 mp/maxMp（默认 50），重置后满；
- **消耗**：cast('fireball') 成功 → mp 减少 12、返回 true；mp 不足时 cast 返回 false 且 mp 不变；
- **冷却**：cast 后 getCooldown('fireball')===3；行动 1 次后 -1；行动 3 次后归 0 可再放；
- **伤害公式**：火球对怪物伤害 === round(atk*1.8)（构造确定 atk 断言）；
- **护盾**：cast('shield') 后 shieldValue===round(maxHp*0.25)，怪物命中先扣护盾；
- **旧档兼容**：无 mp 字段的存档 load 后补默认；
- **快捷键数据**：SKILLS 的 key 为 4/5/6；
- 重复 cast/重置不抛错；
- title/body 各出现一次 `PASS {...}`。

## 七、回归要求

- 主游戏 `index.html` headless 冒烟：无 `Uncaught/TypeError/ReferenceError/SyntaxError`。
- S3-1/2/3/4 + M9-1/2/3/4/5 验证页复跑 PASS（MP 接入后 HUD 断言若引用旧 0/0 需同步更新——如发现回归失败先核对 HUD 验证页断言口径）。
