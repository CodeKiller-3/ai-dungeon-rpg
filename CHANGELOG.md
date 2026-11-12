# 更新日志（CHANGELOG）

本文件记录**已实现并已通过回归**的变更。版本号唯一权威来源是 `index.html` 的 `<meta name="game-version">`，本文件顶部条目与之一致。

> 每条条目末尾带一个不可见的锚点注释（形如 `锚点: 相对路径#符号名`），由 `preflight/verify_d31.html` 扫描校验"提到的功能在代码里真实存在"，防止把没做的功能写进来。

## [1.0.0] - 2026-11-12

首个可交付版本：五层地牢、回合制战斗、背包装备、商店、任务、图鉴、排行榜、本地存档、四类 AI 能力（A\* / 行为状态机 / 大模型 NPC / Q-learning），零构建、`file://` 双击即玩。

### 机制

- 五层地牢：DFS 迷宫生成、上下楼梯换层、每层主题与期望强度单调递增（第 5 层 44.1）。<!-- 锚点: js/data/maps.js#floors -->
- 回合制战斗：攻击 / 防御 / 逃跑，经验金币掉落、死亡结算。<!-- 锚点: js/systems/battle.js#Game.Systems.Battle -->
- 伤害公式（D-34）：`max(1, round(atk²/(atk+def)))` 比例减伤，替换旧的 `max(atk-def,1)`——def 5→45 实数曲线严格递减、无免疫点、无断崖；五层期望受击伤害由 `1.00/1.50/1.75/3.35/1.25`（F4>F5 倒挂）修正为 `3.25/6.75/7.30/11.75/12.90`。<!-- 锚点: js/systems/battle.js#damage( -->
- 最终 Boss（D-34）：地牢巨龙 `hp150/atk18` → `hp260/atk32`，atk 与 hp 双项严格大于第 5 层最强普通怪（天使 hp180/atk28、大僵尸 hp240/atk26）；二阶段 enrage 参数未动。Boss 不在普通表，五层期望强度与 DC-04 基线不变。<!-- 锚点: js/data/monsters.js#dragon -->
- 三技能：火球 / 冲刺 / 护盾，消耗 MP、按回合冷却。<!-- 锚点: js/systems/skills.js#Game.Skills -->
- 三名 Boss 二阶段：第 2 层独眼酋长、第 4 层僵尸王、第 5 层地牢巨龙（半血狂暴）。<!-- 锚点: js/data/monsters.js#enrage -->
- 陷阱与状态：地刺 / 毒气，流血 / 中毒按回合结算。<!-- 锚点: js/systems/battle.js#Game.Systems.Status -->
- 密室：第 2 层起每层最多 1 间单门封闭房间 + 密室宝箱。<!-- 锚点: js/systems/map.js#Game.Systems.Map -->
- 装备强化 +1~+5：强化卷轴、每级 +10% 向上取整、`effValue` 单一公式。<!-- 锚点: js/systems/inventory.js#effValue -->
- 12 条任务（1 主线 + 11 支线），按击杀 / 楼层 / 等级 / 收集推进。<!-- 锚点: js/data/quests.js#Game.Data.QUESTS -->
- 图鉴：怪物 / 物品自动登记，未遭遇显示 ???。<!-- 锚点: js/systems/bestiary.js#Game.Systems.Bestiary -->
- 本地排行榜：通关时间 / 金币 / 等级，最近 10 条。<!-- 锚点: js/systems/leaderboard.js#aiDungeon_leaderboard -->
- 起手匕首：新档与重开都发一把 `knife`（+1 攻击），旧档不补发。<!-- 锚点: js/core/main.js#START_WEAPON -->
- 本地存档 `ai_dungeon_rpg_save_v1`：自动存档、读档按等级重算属性。<!-- 锚点: js/systems/save.js#ai_dungeon_rpg_save_v1 -->
- 大模型 NPC 对话：配置 Key 走 DeepSeek，无 Key / 断网降级为离线规则问答。<!-- 锚点: js/systems/npc.js#Game.Systems.NPC -->
- Q-learning 寻宝鼠演示：ε-贪心 + 距离势引导，实时显示成功率。<!-- 锚点: js/systems/learner.js#Game.Systems.Learner -->
- 怪物 AI：巡逻→追击状态机 + A\* 逐格追击。<!-- 锚点: js/systems/ai.js#Game.Systems.AI -->

### 界面

- 游戏内弹窗：背包 / 商店 / 任务图鉴 / 设置 / 死亡结算，键盘 ↑↓ + Enter 与鼠标点击双路。<!-- 锚点: js/systems/modal.js#Game.Modal -->
- 背包信息层：页头装备摘要、行尾「已装备 / 强化实值」徽标、逻辑宽 ≥700 的只读装备栏、装备对比差值（`modal._rowDelta`，▲/▼/持平）。<!-- 锚点: js/systems/modal.js#_railLayout -->
- 物品图标：48 件物品 48 条显式映射，逻辑宽 <420 自动不画图标。<!-- 锚点: js/data/items.js#ITEM_ICONS -->
- 顶部 HUD：心形血条、金币、楼层、击杀进度、等级经验。<!-- 锚点: js/systems/hud.js#Game.hud -->
- 底部提示条：战斗失败原因、引导、胜利与升级文字统一走 `ui:notice`。<!-- 锚点: js/systems/notice.js#Game.Notice -->
- 战斗表现：时间轴分段、伤害飘字、受击抖动、顿帧与震屏。<!-- 锚点: js/systems/fx.js#Game.Fx -->
- 音效与 BGM：Web Audio 程序化合成，三场景自动切换，K 静音 / Q 音量面板。<!-- 锚点: js/systems/audio.js#Game.Systems.Audio -->
- 视野与光影：rot.js 精确投影迷雾、火把光晕、视野软边、暗角。<!-- 锚点: js/systems/fov.js#Game.fov -->
- 地图贴图逻辑（D-35）：贴图尺寸改为「原生高 × `TILE/16`、脚底锚定格底」（玩家 21→42px、史莱姆 18px < 独眼酋长 37.5px），装饰按脚下行浮点位置参与 y 前后关系（走进物件那一行时物件盖脚、静止同格时人在前），埋伏整格红膜改为脚下警戒环，落地物件与角色统一补中性地面投影。战场 112.5px 口径未动。<!-- 锚点: js/core/main.js#drawMap -->
- Q-learning 演示复位与指标口径（D-36）：`init()` 把 `epsilon` 与 Q 表 / 轮次 / 统计 / 走势窗口一起复位——第二次按 L 不再从 ε=0.05 起跑（旧实现只清 Q 表、漏复位探索率，二进宫直接退化成撞墙鼠）；走势图改成真正的「最近 20 轮滚动成功率」，与图上标签同口径（此前画累计、标签写近 20 轮）；`verify_c05` 移除用 `eval` 重载模块的绕过，改测玩家真实使用的单例路径，并新增 C5-6 守门断言。7 图 Q / 随机成功率与移除绕过前逐项相同。<!-- 锚点: js/systems/learner.js#EPS_INIT -->

### 工具

- 回归批跑：86 个 headless 验证页 + 页数兜底（页数不符即 FAIL，杜绝 `TOTAL=0` 假绿）。<!-- 锚点: preflight/selfcheck/run-all.ps1#Get-PageVerdict -->
- 素材审计：207 张 PNG 的空帧 / 尺寸 / 编号 / 注册 / 60 色调色板一次性核对。<!-- 锚点: preflight/selfcheck/d21_audit.js#paletteSize -->
- 三层自检：UI / 数据口径 / 文档一致性共 33 项，含 README 数字一致性。<!-- 锚点: preflight/selfcheck/selfcheck.js#SUMMARY -->
- bot 跑局压测台：同种子批量跑局，产出死亡归因统计。<!-- 锚点: preflight/bot_d23.html#maxActions -->
- 装备经济审计（D-45）：`d17_bot` 只新增 `opts.d45` 商店决策遥测（每次开张记金币/货架/成交/原因）与 `opts.d45Probe` 武器档位反事实，既有分支不变。25 个到 F5 的局共 125 个层商店机会：成交 9 次、货架没有 4 次、**金不够 112 次（96.6%）**、没进店 0、优先级买错 0——只买 10 次装备是"没钱"，不是"没走到"。武器价值：seed 1042 逐档换武器，atk15→146、17→163、19→142、22→175、26→213（基准，与 D-44 一致）、30→230，全部输；**现有物品表里最强档（atk16→玩家 atk30）仍差 30 血**，最低获胜档位在表内不存在。上限测量：F5 起点免费发最强武器仍 1/50 通关；从 F1 起免费发 atk16 才 6/50（但属禁止项"免费高阶武器"），从 F1 起发 atk3/5/8 全部 0/50。结论：**本卡不改任何补给数值**——金币/药水不在允许范围，商店核心货架均价（S-03 40.7/92.2/236.7/259.4/441.9）与轮换池档位（C3-1）被既有断言锁死，改价必使既有 verify FAIL。`verify_d45` A–F 守门（A 逐局复算且四类占比=100%、B 档位表与 1042 基线、C 还原负例复现 1/50 且差值断言 FAIL、D 三条护栏、E 四策略与 D-44 逐项相同、F 怪物/巨龙/物品/补给表指纹未变）。<!-- 锚点: preflight/lib/d17_bot.js#d45Snapshot -->
- 通关可行性（D-44）：`d17_bot` 只新增 `opts.b1` 冲刺分支——F1–F4 寻路把怪当墙、只打挡路/巡逻贴脸，宝箱只开绕行 ≤4 步的顺路箱，商店留到临下楼前结算；F5 直奔 Boss，火球只在"冷却好 / MP≥12 / 比普攻多 ≥3 / 普攻收不掉"时放，Boss 血量 ≤45% 嗑药。同种子 1001–1050 / maxActions 2500 与 G2/S1/M1 逐字段对照：B1 到 F5 25/50、击杀巨龙 1/50、通关 1/50（seed 1004，L6 剑魂+锁子甲，14 回合 264 伤害，剩 113 HP 2 瓶药）。未达 3/50 击杀：最接近的 seed 1042 把龙打到剩 47 血（81.9%）、12 回合、4 瓶药耗尽，差约 3 回合 / 47 输出；缺口主要在武器与等级（DPS），不是药。`verify_d44` A–E 守门（含 A 负例不绕怪、C 负例不补药、D 完整事件序列、E `js/` 零改动）。<!-- 锚点: preflight/lib/d17_bot.js#b1Plan -->
- 血量经济审计（D-43）：先给每次 HP 增减记账（普攻/Boss 技能/毒/流血/陷阱；升级/药水），证明 M1 改前四层承伤÷回复全部 >1（F3 1.853），F3 每层只新得 0.28 瓶药——是补给问题而非密度问题。只改补给：F2–F5 的药水掉落档位与概率、宝箱药水池（普通箱药水 1/3→3/5、密室 1/4→2/5）；怪物 hp/atk/def、Boss、伤害公式、楼层结构、价格与物品哈希全部未动。M1 到 F4 6→27、F3 出口 12.76→72.30（44.9%）、S1 到 F5 8→12、G2 6→11；护栏每层新得 2.08（≤3）、单局最多 14 瓶（≤15）。M1 到 F5 仍 0/50：5 局活着但撞 2500 动作上限，差 2 局。`verify_d43` A–F 守门。<!-- 锚点: js/data/monsters.js#skeleton -->
- Boss 断层审计（D-42）：用 D-34 五层期望（11.125/20.125/23.75/36.85/44.1）重算每层门位，只改比值倒挂的两只层 Boss——F2 独眼酋长 `280/24/10→120/12/8`（击杀 22→9 回合、可扛 9→22 回合，比值 2.44→0.41）、F4 僵尸王 `420/30/12→280/24/12`（15→10 回合、可扛 10→14 回合，比值 1.50→0.71）；巨龙 `260/32/8` 与 enrage、伤害公式、楼层结构、位置全部未动。`verify_d42` A–F 校验 8 个 Boss/精英同公式复算、全部比值 ≤0.75 且击杀 ≥6、还原负例、同种子跑局、巨龙与价格哈希不变。<!-- 锚点: js/data/monsters.js#ogre_boss -->
- 成长节奏重排（D-41）：升级经验阈值改两段——L1–L4 为 15×level、L5 起仍 60×level（旧版全程 60×level）；普通推进在 F2–F3 可到 L5，全图清完约 L9–L10。伤害公式、Boss、楼层结构与升级增量（+1/+1/+10/+0）均未动；`verify_d41` A–E 校验同种子可复现、归因唯一、曲线负例、价格收敛与 D-40 公式复算。<!-- 锚点: js/systems/battle.js#expToNext -->
- 成长上限审计（D-40）：`d17_bot` 只新增 `opts.m1` 刷满分支（全清怪/拿宝箱/买最贵/用卷轴，无逃跑）；同种子 1001–1050 / maxActions 2500 产出 `d40-m1.json`；`verify_d40` A–E 复算属性公式、追溯上限来源、校验同种子矩阵、强制外推值带 `extrapolated=true`。只读诊断，`js/` 一字未改。<!-- 锚点: preflight/lib/d17_bot.js#m1Plan -->
- 潜行可行性测量（D-39）：`d17_bot` 只新增 `opts.d39` 纯潜行分支——怪物格一律当障碍（BFS 三级：绕怪探图 → 绕怪下楼/Boss → 绕不过去才撞上去并记录地形快照），强制遭遇时 Boss/挡路怪不逃、巡逻怪先逃（最多 2 次）、只用技能与药；同种子 1001–1050 / maxActions 2500 与 D-37 G2 完全对齐，`d39-s1.json` / `d39-neg.json` 分文件落盘，`verify_d39` A–E 守门。只产数据，不产平衡判决。<!-- 锚点: preflight/lib/d17_bot.js#d39Plan -->
- F5 卡关与死因误报（D-38）：地图生成在 `spawnEnemies` 之后校验"出生点连通块必须包含本层必经目标"（非最终层=下行梯、最终层=主线 Boss），不可达时只把目标搬进连通块、不重抽地图（200 种子中 2 张 F5 命中）；bot 死因改为直接读死亡遥测 `source`，探索期状态致死不再算"被怪打死"；最终层补"探索无目标→走向 Boss"兜底，D-37 种子 1013 不再空转。<!-- 锚点: js/systems/map.js#ensureMandatoryTargets -->
- 测量台校准（D-37）：`d17_bot` 只新增 `opts.d37` 三条可选分支——火球（按冷却 / MP 余量 / 伤害增益判据）、逃跑（按"还挨几下会死 vs 还要几回合能杀"判据，含失败反击代价与 6 步喘息绕怪）、刷级（血量 ≥60%、每层最多 2 只、只挑稳赢的怪），既有分支一行未改；G0 与 D-34 报告逐局一致，四组同种子 1001–1050 / maxActions 2500 分文件落盘 `d37-g0..g3.json`，`verify_d37` A–E 守门。只产数据，不产难度判决。<!-- 锚点: preflight/lib/d17_bot.js#d37DecideFireball -->
- 线上核验产物：逐页记录 Pages 取数通道的运行时裁决行。<!-- 锚点: preflight/selfcheck/d26-online-verify.json#pages -->

### 文档

- README：玩法、按键、AI 亮点与四组 Q-learning 口径、目录结构、组件来源。<!-- 锚点: README.md#功能列表 -->
- 任务卡体系：每张卡一份 `docs/tasks/*.md`，含契约与验收。<!-- 锚点: docs/tasks/S3-3-modal.md#弹窗 -->
- 第三方许可：`THIRD-PARTY-NOTICES.md`（含 rot.js BSD-3 全文）与 `assets/sprites/LICENSE.md`。<!-- 锚点: THIRD-PARTY-NOTICES.md#rot.js -->
- 本更新日志与版本号收敛：`index.html` meta 为唯一版本源。<!-- 锚点: CHANGELOG.md#锚点 -->

### 归档

- 阶段 B1 目录归位：根目录 4 份过程报告迁入 `docs/process/`（正文逐字节保留，各加一行来源说明），12 张响应式截图迁入 `preflight/artifacts/shots_resize/`；`PLAN.md` / `README.md` / `CHANGELOG.md` / `THIRD-PARTY-NOTICES.md` / `规划-对标补齐.md` 与全部验证页原地不动。<!-- 锚点: README.md#目录结构 -->
- 阶段 B2（搬 `js/` 与 `preflight/verify_*.html`）**永久不做**：实测要改 ≥11 个硬编码 `preflight/` 路径的工具、67 个验证页里的 1375 处 `../js/` 引用，收益与风险不成比例；决定与依据见 `docs/process/D-32-归档决定.md`。<!-- 锚点: README.md#文档索引 -->
