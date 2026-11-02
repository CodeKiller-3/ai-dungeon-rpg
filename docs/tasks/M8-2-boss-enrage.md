# M8-2 任务卡：Boss 二阶段（巨龙半血狂暴 + 烈焰吐息）

> 阶段：M8 内容深度（PLAN.md §14.3 / §15.4 M8-2）
> 目标：地牢巨龙血量 ≤50% 时进入狂暴二阶段——攻防提升 + 新技能"烈焰吐息"，数值可复算
> 打磨上限：3-5 遍（判据是 PASS，不是遍数）

## 一、背景

Boss 现有定义（`js/data/monsters.js`）：`dragon { hp:150, atk:18, def:8, exp:60, gold:[40,80], drops:[sword_dragon 25%, potion_large 50%] }`。战斗流程见 `js/systems/battle.js`（monsterTurn 统一伤害入口，M8-1 已加入护盾抵挡）。

## 二、契约（纯新增字段 + 状态，不改既有战斗流程）

### 2.1 怪物数据扩展（monsters.js）

```
dragon: { ..., enrage: {
  hpPct: 0.5,        // 血量 ≤50% 触发
  atkMul: 1.5,       // 狂暴后 atk = round(原 atk × 1.5)
  defMul: 1.3,       // 狂暴后 def = round(原 def × 1.3)
  skill: { name: '烈焰吐息', chance: 0.3, dmgMul: 1.4 }  // 狂暴后每回合 30% 概率使用，伤害 = max(round(狂暴 atk × 1.4) - 玩家 def, 1)
}}
```

- 全部**可复算公式**，不硬编码最终数值；
- 无 enrage 字段的普通怪不受影响（行为与现在完全一致）。

### 2.2 狂暴状态机（battle.js）

- **触发**：怪物受击后血量 ≤ `hp × hpPct` 且未狂暴 → 进入狂暴：`state.enraged = true`，logPush 提示（如"地牢巨龙发出怒吼，陷入狂暴！攻击与防御提升"），怪物 atk/def 临时提升（存在 `state.enrageAtk / state.enrageDef`，不写回 data 定义）；
- **单次触发**：狂暴只触发一次（重复受击不叠加倍率、不重复提示）；
- **怪物行动**：狂暴后每回合 `Math.random() < chance` 使用吐息：伤害按 `dmgMul` 公式，飘字/粒子/音效复用既有通道（logPush 注明"地牢巨龙喷出烈焰吐息！"），且本回合替代普攻；未命中则普攻（伤害用狂暴 atk）；
- 玩家防御指令对吐息同样减伤 50%（与普攻一致）；
- 死亡结算（exp/gold/drops）不受狂暴影响。

### 2.3 状态暴露（只读）

- `getState()` 返回含 `enraged`（bool）、`enrageAtk`/`enrageDef`（数值），供渲染与验证。

## 三、文件范围

| 文件 | 动作 |
|---|---|
| `js/data/monsters.js` | 修改：dragon 增 enrage 字段 |
| `js/systems/battle.js` | 修改：狂暴触发判定、enrage 数值、吐息行动分支、getState 暴露 |
| `js/core/render.js` | 修改（如需要）：战斗画面狂暴提示或吐息视觉（飘字/粒子已复用，仅文字提示可选） |
| `README.md` | 修改：功能列表补充 Boss 二阶段 |
| `preflight/verify_m8_2.html` | **新增**：R-01 模板验证页 |

## 四、硬性约束

- 原生 JS + Canvas 零构建；file:// 双击 index.html 可玩；不引入 npm/构建工具/付费资源。
- **不改** 普通怪战斗行为与既有接口语义（attack/defend/run/skill 命令不变）。
- 狂暴数值全部公式化（atk×1.5、def×1.3、吐息 round(狂暴atk×1.4)），验证页按公式复算断言。
- 狂暴只触发一次；不写回 monsters.js 原值（临时存 battle state）。
- 吐息受玩家防御指令减伤 50%（与普攻同规则）。

## 五、完成标准

1. 列出改动文件清单（文件 + 行数概览）。
2. 用下方验证命令跑 `preflight/verify_m8_2.html`，输出必须出现 `enrageLoaded:true`、`enrageApi:true`、`enrageOk:true`。
3. 说明剩余风险点。
4. 实现不了的直接说卡点与尝试，不绕过不改方案。

## 六、验证命令（Start-Process 方案）

```
$env:PATH="C:\Windows\System32;C:\Windows;$env:PATH"
$edge="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$od="$env:TEMP\m82.out.txt"; $ed="$env:TEMP\m82.err.txt"; $pd="$env:TEMP\edgem82"+(Get-Random)
Start-Process -FilePath $edge -ArgumentList "--headless=new","--disable-gpu","--no-first-run","--user-data-dir=$pd","--virtual-time-budget=3500","--dump-dom","file:///D:/桌面/工作/人工智能大作业/preflight/verify_m8_2.html" -Wait -PassThru -RedirectStandardOutput $od -RedirectStandardError $ed | Out-Null
Get-Content $od -Raw
```

验证页要求（加载顺序与主游戏一致）：
- 模块加载与接口齐备（enrage 字段存在、getState 返回 enraged/enrageAtk/enrageDef）；
- **公式**：狂暴后 atk===round(18×1.5)===27、def===round(8×1.3)===10（用 dragons 数据复算断言）；
- **触发**：怪物 hp 打到 ≤75 时 enraged 变 true 且 log 含"狂暴"提示；
- **单次**：继续受击到更低血量，enraged 仍 true 且不重复提示（log 中提示仅 1 条）；
- **吐息**：狂暴后怪物行动存在吐息分支（chance 用确定性注入：构造 `Math.random` 返回值断言伤害===max(round(27×1.4)-def,1)===max(38-def,1)）；未狂暴怪（slime）无 enrage 行为（行动仍普攻）；
- **防御减伤**：玩家防御时吐息伤害减半（与普攻同规则断言）；
- 普通怪（slime/bat/skeleton）全流程不受影响（start→playerAction attack 正常结算）；
- 重复 start 不抛错；
- title/body 各出现一次 `PASS {...}`。

## 七、回归要求

- 主游戏 `index.html` headless 冒烟：无 `Uncaught/TypeError/ReferenceError/SyntaxError`。
- S3-1/2/3/4 + M9-1/2/3/4/5 + M8-1 验证页复跑 PASS。
