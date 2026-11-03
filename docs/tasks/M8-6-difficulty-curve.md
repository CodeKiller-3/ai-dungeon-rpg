# M8-6 任务卡：难度曲线（升级成长 + 逐层强度平衡 + 不刷可通关验证）

> 阶段：M8 内容深度收官（PLAN.md §14.3 / §15.4 M8-6）
> 目标：补全升级成长循环（exp→升级→atk/def/maxHp 成长）；怪物表逐层强度单调递增；不刷怪可通关
> 打磨上限：2-3 遍（判据是 PASS，不是遍数）

## 一、背景（重要审计结论）

**当前游戏无升级系统**：`battle.settleWin`/`quest.progress` 只累计 `p.exp`，`p.level` 恒为 1，atk/def 仅靠装备提升。3 层 dragon（M8-2 狂暴后 atk 27）对玩家 atk 10+装备 几乎不可战胜——"不刷可通关"在无成长下不成立。本任务补全核心循环。

## 二、契约

### 2.1 升级成长（核心新增，公式全部可复算）

- **经验阈值**：`expToNext(level) = 60 × level`（L1→L2 需 60）；
- **升级**：exp 达到阈值自动升 1 级（可连续升级，exp 溢出保留到下一级）；
- **成长**：每级 `atk +1`、`def +1`、`maxHp +10`（基础 L1=10/5/100）；
- **升级效果**：`hp = maxHp`、`mp = maxMp`（回满）；
- **登记点**：`battle.settleWin` 加 exp 后、`quest` 完成加 exp 后，统一走 `checkLevelUp()`（新增函数，幂等）；
- **HUD**：等级旁显示经验进度 `Lv.3 60/180`（现有 HUD 有 level 显示，扩展为带 exp/expNext 文本，窄窗口紧凑版自动截断或缩小字号，不溢出）。

### 2.2 怪物表平衡（maps.js 微调）

- 现表：`[slime60/bat40] → [bat50/skeleton50] → [skeleton60/dragon40]`
- 调整：3 层 `dragon 40% → 25%`（skeleton 补足 75%），1/2 层保持；
- **逐层单调递增审计断言**：每层"期望强度" = Σ(怪物 rate × (atk + hp/10))，断言 `强度(1层) < 强度(2层) < 强度(3层)`（用公式可复算）。

### 2.3 不刷可通关（验证页模拟断言，不改玩法）

- 模拟"不刷怪"路径：1 层必经 5 场（经验按 1 层池平均），2 层必经 5 场，3 层到 dragon 前 3 场 skeleton；
- 断言：**打完 1 层升到 ≥2 级、打完 2 层 ≥3 级、3 层 dragon 战前 ≥4 级**（用 expToNext 公式复算）；
- 断言：L4 + 商店可买最优装备（sword_dragon atk8）后 `atk ≥ 20`，对 dragon（狂暴 def 10）每回合伤害 ≥ 10（可复算），保证"不刷可通关"在数值上成立（不承诺操作必赢，只保证数值可行）。

## 三、文件范围

| 文件 | 动作 |
|---|---|
| `js/core/main.js` 或 `js/systems/battle.js` | 修改：`checkLevelUp`（推荐放 main.js 附近或 battle.js，取加载依赖最小处）；settleWin/quest 完成接入；升级成长与回满 |
| `js/systems/hud.js` | 修改：等级旁经验进度文本 |
| `js/data/maps.js` | 修改：3 层 dragon 25% |
| `js/data/quests.js` | 修改（如需要）：不强制改任务奖励 |
| `README.md` | 修改：功能列表补充升级成长/难度曲线 |
| `preflight/verify_m8_6.html` | **新增**：R-01 模板验证页 |

## 四、硬性约束

- 原生 JS + Canvas 零构建；file:// 双击 index.html 可玩；不引入 npm/构建工具/付费资源。
- 升级公式与成长全部**可复算**（60×level、+1/+1/+10），验证页按公式断言。
- **不改**既有战斗/掉落/商店语义；升级是 exp 累加后的新逻辑（幂等，重复调用不重复升级）。
- 存档兼容：旧档 `level/exp` 存在直接沿用；升级后 atk/def 会与旧存档不一致（以当前成长规则重算基准：`atk = 10 + (level-1)`、`def = 5 + (level-1)`、`maxHp = 100 + (level-1)×10`——读档后按此重算，不信任旧 atk/def 持久值，避免旧档错值）。
- HUD 经验文本不改变现有布局宽度语义（窄窗口可截断/缩字号，不横向溢出）。

## 五、完成标准

1. 列出改动文件清单（文件 + 行数概览）。
2. 用下方验证命令跑 `preflight/verify_m8_6.html`，输出必须出现 `curveLoaded:true`、`curveApi:true`、`curveOk:true`。
3. 说明剩余风险点。
4. 实现不了的直接说卡点与尝试，不绕过不改方案。

## 六、验证命令（Start-Process 方案）

```
$env:PATH="C:\Windows\System32;C:\Windows;$env:PATH"
$edge="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$od="$env:TEMP\m86.out.txt"; $ed="$env:TEMP\m86.err.txt"; $pd="$env:TEMP\edgem86"+(Get-Random)
Start-Process -FilePath $edge -ArgumentList "--headless=new","--disable-gpu","--no-first-run","--user-data-dir=$pd","--virtual-time-budget=3500","--dump-dom","file:///D:/桌面/工作/人工智能大作业/preflight/verify_m8_6.html" -Wait -PassThru -RedirectStandardOutput $od -RedirectStandardError $ed | Out-Null
Get-Content $od -Raw
```

验证页要求（加载顺序与主游戏一致）：
- 模块加载与接口齐备（expToNext/checkLevelUp 可调用，HUD 数据含 exp/expNext）；
- **公式**：expToNext(1)===60、expToNext(3)===180；
- **升级**：构造 p{level:1,exp:70} → checkLevelUp → level===2、exp 溢出保留 10、atk===11、def===6、maxHp===110、hp===110、mp===maxMp；
- **连续升级**：exp 一次加 300（level 1）→ 连升到 level 3（60+120=180 消耗，余 120→L3 需 180 不足，停在 3 级 exp=120）——按公式复算断言；
- **幂等**：重复调用 checkLevelUp 不重复升级（exp 不足时无变化）；
- **怪物表**：3 层 dragon rate===0.25、skeleton===0.75；逐层期望强度单调递增断言通过（公式复算）；
- **不刷可通关**：模拟路径（5/5/3 场平均经验）后 level 断言（1 层后 ≥2、2 层后 ≥3、3 层 dragon 前 ≥4）；L4 装备 sword_dragon 后 atk≥20 且对狂暴 dragon 单回合伤害≥10；
- **读档重算**：旧档 {level:5, atk:999} load 后 atk===14（10+4）、def===9、maxHp===140（不信任旧值）；
- HUD 绘制含经验文本不抛错（窄窗口调用同路径）；
- 重复调用不抛错；
- title/body 各出现一次 `PASS {...}`。

## 七、回归要求

- 主游戏 `index.html` headless 冒烟：无 `Uncaught/TypeError/ReferenceError/SyntaxError`。
- S3-1/2/3/4 + M9-1/2/3/4/5 + M8-1/2/3/4/5 验证页复跑 PASS（M8 收官后全量 14+ 页）。