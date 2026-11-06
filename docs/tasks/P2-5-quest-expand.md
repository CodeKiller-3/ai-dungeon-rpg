# P2-5 任务扩量（3 → 12 条：分层击杀 / 抵达 / 等级 / 收集 / Boss 支线）

> 阶段：P2 内容扩量 · 第 5 卡（P2 收尾）
> 状态：待 Trae 实现

## 一、背景与目标

当前任务只有 3 条（主线杀龙、杀 5 史莱姆、累计 100 金），任务栏几乎空。本卡扩到 **12 条**，覆盖 F1~F5 五层推进节奏，并新增 3 种任务类型（`floor` 抵达 / `level` 等级 / `collect` 收集），让任务系统成为贯穿全程的目标引导。不改任务奖励结算机制（仍是 gold+exp+checkLevelUp+`quest:complete`）。

## 二、实现要点

### 1. js/data/quests.js — 12 条任务
保留现有 3 条（原文不动），新增 9 条：

| id | type | target/count | reward | 描述 |
|---|---|---|---|---|
| kill_slimes | kill | slime / 5 | 30g 20exp | 现有 |
| gold_rich | gold | 100 | 50g 30exp | 现有 |
| main_clear_dragon | kill | dragon / 1 | 200g 100exp | 现有 |
| kill_goblins | kill | goblin / 5 | 40g 25exp | 支线：清理 5 只哥布林 |
| kill_orcs | kill | orc_warrior / 5 | 70g 45exp | 支线：击退 5 名兽人战士 |
| kill_undead | kill | skeleton / 5 | 60g 40exp | 支线：净化 5 具骷髅 |
| kill_zombies | kill | big_zombie / 3 | 90g 60exp | 支线：重创 3 只大僵尸 |
| slay_ogre_chief | kill | ogre_boss / 1 | 120g 80exp | 支线：击败第 2 层独眼酋长 |
| slay_zombie_king | kill | zombie_king / 1 | 160g 110exp | 支线：击败第 4 层僵尸王 |
| reach_floor3 | floor | 3 | 60g 40exp | 支线：抵达第 3 层 |
| level_5 | level | 5 | 80g 60exp | 支线：达到 5 级 |
| collect_potions | collect | potion_large / 3 | 50g 30exp | 支线：收集 3 个大血瓶 |

- 12 条、类型合法、count>0、reward≥0；描述文案不含具体层号以外的不一致信息。

### 2. js/systems/quest.js — 扩展匹配
`progress(type, arg)` 的 match 判断扩充（保持现有 kill/gold 行为不变）：
```js
if (q.type === 'kill' && type === 'kill' && q.target === arg) match = true;
if (q.type === 'gold' && type === 'gold') match = true;
if (q.type === 'floor' && type === 'floor' && arg >= q.target) match = true;
if (q.type === 'level' && type === 'level' && arg >= q.target) match = true;
if (q.type === 'collect' && type === 'collect' && q.target === arg) match = true;
```
- 数值累计规则：`floor`/`level` 为"到达即完成"（progress 直接置为 target 或 count）；`collect` 与 kill 同构按 +1 累加。
- 完成结算路径不变（gold/exp → checkLevelUp → emit `quest:complete`）。
- 已完成任务不再重复计数（现有 `st.done` 判断保留）。

### 3. 触发点接入（三处，最小改动）
- **floor**：`js/systems/map.js` 每次 `map:floorChanged` emit 后调用 `Game.Systems.Quest.progress('floor', floorIndex + 1)`（两处 emit 点都要，或抽函数）。
- **level**：`js/systems/battle.js` 的 `checkLevelUp`（升级成功后）调用 `Game.Systems.Quest.progress('level', p.level)`（注意：只在确实升级时调，避免每战重复）。
- **collect**：`js/systems/inventory.js` 的 `add` 在物品真正入包后调用 `Game.Systems.Quest.progress('collect', id)`（数量 ≤0 不调；add 返回 false 不调）。

### 4. 任务界面
- `quests` 任务页最多 12 条 < `MAX_VISIBLE=12`，不触发滚动（已有 qScroll 逻辑兼容）；若某刻活跃任务 >12 需确认滚动生效（理论上不会，getActive 只返回未完成）。
- 不新增任务分类/页签。

## 三、硬性约束

- 不改任务奖励结算机制、不改存档结构（新任务 id 由 `Quest.init()` 自动补齐，旧档兼容）。
- 不改战斗公式/升级曲线/地图生成/Boss 数据/物品数据/素材。
- `quests.js` 现有 3 条原文不动（id/type/target/count/reward/desc 逐字保留）。
- file:// 零构建可玩。

## 四、完成标准

1. 改动文件清单。
2. 新建 `preflight/verify_p2_5.html`（R-01 模板），断言：
   - t2_questCount：`QUESTS.length >= 12`，每条 type ∈ {kill,gold,floor,level,collect}，count>0，reward.gold/exp ≥ 0，id 唯一
   - t3_oldQuests：现有 3 条 id/type/target/count/reward 与基线一致
   - t4_floorQuest：`Quest.progress('floor',3)` 后 `reach_floor3.done=true` 且奖励只发一次（再调一次 gold 不增加）
   - t5_levelQuest：`Quest.progress('level',5)` 后 `level_5.done=true`
   - t6_collectQuest：`Inventory.add('potion_large',1)` 三次 → `collect_potions.done=true`；add 失败/数量 0 不推进
   - t7_killQuests：模拟击杀 goblin×5 / orc_warrior×5 / ogre_boss×1 / zombie_king×1 后对应任务 done
   - t8_initCompat：清空 Player.quests 后 `Quest.init()` 补齐 12 条且默认 progress 0/done false
   - t9_noDuplicate：任一任务完成后重复 progress 不重复发奖励
   - 输出 `PASS {"questLoaded":true,"questApi":true,"questOk":true}` + 子断言
3. 受影响页同步：`verify_m4`（若有 3 条任务数量断言）、`verify_m8_6`（t10_quest 若基于任务列表）、`verify_p2_4`（若含任务相关）。逐一确认或说明。
4. index.html 冒烟 0 JS 错误；全量回归全 PASS。
5. 剩余风险点。

## 五、风险点（已知）

- `floor` 进度在载入存档时不会再触发一次（只在换层时推进）；读档停在第 5 层的旧档需要下/上一层才点亮 reach_floor3，属可接受行为（或 init 时用当前层补一次，自行决定并说明）。
- `level` 任务若玩家已 5 级以上才接（旧档），需靠下一次升级才完成；同理可在 init 时用当前等级补一次。
- 任务奖励给 exp 会触发 checkLevelUp，再触发 level 任务 → 形成链式完成（正常，但需避免无限循环；progress 内已完成标记已防）。
- 12 条任务全部做完后任务页为空（显示"暂无任务"），属现有行为。
