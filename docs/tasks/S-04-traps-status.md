# S-04 陷阱与状态效果

- 卡片编号：S-04
- 依据：`规划-对标补齐.md` §S-04
- 目标：地牢里出现"看不见、踩了才知道"的伤害来源，以及会持续几回合掉血的状态，把探索从"走路看风景"变成有风险的移动。
- 状态：已实现，`verify_s04.html` 11 项全 PASS，静态自检 32 PASS / 1 WARN / 0 FAIL，全量回归含本页全 PASS。

## 一、玩家可见行为

1. 每层地板上有 3~6 个陷阱，**未触发前完全不可见**（不剧透）。
2. 踩中地刺：立刻扣**当前 HP 的 8%**（第 1 层单次上限 15，其余层上限 30），并附带**流血 2 回合**（每回合 -3 HP）。
3. 踩中毒气：不立刻扣血，改为**中毒 3 回合**（每回合 -2 HP）。
4. 触发过的陷阱**永久显现在该格**（地刺=三根灰刺＋血迹，毒气=绿色雾团），之后站在格子上不再受伤。
5. 顶栏下方出现状态 chip：`中毒3`（绿）/`流血2`（红），回合数随结算递减，归零消失。
6. 「回合」的两种口径：探索里**走一步 = 一个回合**；战斗里**一次行动 = 一个回合**（回合末结算）。

## 二、改动范围

| 文件 | 改动 |
|---|---|
| `js/data/maps.js` | 新增 `Game.Data.TRAPS`（地刺/毒气）、`Game.Data.STATUS`（流血/中毒）、`Game.Data.TRAP_PLACEMENT`（3~6 个 / 出生点 3 格 / F1 只地刺 / gasRate 0.45） |
| `js/systems/map.js` | 新增 `traps` 层（2D `{id,seen}`）；`genDetailsAndDecor` 末尾调 `placeTraps()`；`floorCache` 与缓存复原路径同时带上 `traps`；新增 `getTrap` / `triggerTrap` |
| `js/systems/battle.js` | 新增 `Game.Systems.Status`（apply / clear / clearAll / list / tick）；`playerAction` 末尾 `state.turn++` 后结算状态 |
| `js/core/render.js` | 新增 `_drawTrap()`；`drawMap` 在装饰层之后绘制 `seen` 陷阱 |
| `js/systems/hud.js` | 新增 `drawStatusRow()`；`update()` 接收 `status` 字段（缺省时回落到 `Status.list()`） |
| `js/core/main.js` | Player 增 `status:{}`；`_updateExplore` 步进内先 `Status.tick()` 再移动、移动后先 `triggerTrap()` 再判遭遇；`syncHud` 传 `status`；`restart` 清空状态 |
| `js/systems/save.js` | `load()` 后 `p.status = {}`（状态不入档） |
| `preflight/verify_s04.html` | 新建，t2~t11 |

> 规划 §S-04 列的改动面是 `maps.js / map.js / battle.js / render.js / hud.js` 五个文件。实际执行多动了 `main.js`（踩格触发点与回合边界都在这里，不改就只剩空模块）与 `save.js`（读档清状态）；两处均为一两行，已在此处显式记录，不是静默扩范围。

## 三、不许动

- 不改战斗伤害公式、怪物数值、Boss 狂暴二阶段（状态只作用于玩家）。
- 不改 `SHOP_STOCK` / `SHOP_SCROLLS` / `ITEMS` 数值（陷阱不产生经济收益）。
- 不改楼梯与出生点坐标规则（陷阱只绕开，不改生成器）。
- 不新增 UI 面板、不新增按键。

## 四、断言表（`preflight/verify_s04.html`）

| 编号 | 断言 | 结果 |
|---|---|---|
| t2 | 地刺 8% / 上限 30（F1 15）/ 毒气只给状态；流血 3、中毒 2；放置 3~6、safeRadius 3 | PASS |
| t3 | 五层每层 3~6 个、全在地板格、出生点 3 格内为空、F1 只有地刺 | PASS |
| t4 | HP100 → 地刺 8；HP400 → 32 被钳到 30（剩 370） | PASS |
| t5 | 同格二次踩中返回 null、`seen=true`、HP 不变 | PASS |
| t6 | 毒气 → 中毒 3，HP 100→98→96→94，状态消失 | PASS |
| t7 | 状态扣血致死 → 触发 `battle:end {result:'lose'}` | PASS |
| t8 | HUD `last.status` 反映回合数；无状态为空数组 | PASS |
| t9 | 存档 JSON 无 `status` 键；读档后 `status={}` | PASS |
| t10 | `_drawTrap` 对地刺/毒气均可调用不抛错 | PASS |
| t11 | 满血踩坑安全性：HP 100/140/190/400 的最坏单层合计 21/27/35/65，均 < 半血 | PASS |

## 五、完成定义

- [x] 五种状态全部可在实机触发（探索踩格 + 战斗回合两处都结算）
- [x] 触发后永久显现，且不再重复伤人
- [x] HUD 有剩余回合显示，且不横向溢出（放不下即截断）
- [x] 陷阱不入档，读档不会带着中毒进新局
- [x] `verify_s04.html` 全 PASS，且已进 `run-all.ps1` 回归集
- [x] 静态自检不因本卡新增 FAIL

## 六、取舍与已知缺口

1. **陷阱没有接入 `verify_m8_6` 的解析式通关模拟**。该页只模拟经验/等级/伤害，不含陷阱；本卡改用 t11 的"满血不可被单层陷阱打死"数值证明（最坏 65 vs 半血 200），未给出含陷阱的整局通关率。若后续要卡死这条红线，需把陷阱期望伤害并入 m8_6 的 5 层模拟。
2. **毒气不产生视野遮挡**。规划只说"触发后显现"，没有雾效要求；雾团目前是静态圆斑，不扩散、不衰减。
3. **陷阱不与 AI 结算**。巡逻怪站在陷阱格不会触发（陷阱只对玩家生效），避免怪物自己踩死自己导致难度漂移。
4. **状态无治疗手段**。解毒/止血药水未做（`ITEMS` 未扩），当前只能等回合自然消退；这是刻意的，避免 S-04 顺手扩物品表。
5. **流血与中毒只差数值和名字**（3/回合 ×2 回合 vs 2/回合 ×3 回合），没有各自独立的附加机制；差异化留给后续"更多状态"卡。
6. **重生成地图会重置陷阱**（`setFloor` 清空 `floorCache`），所以读档回到某层时该层陷阱是全新的，已踩过的显现记录不跨读档保留。
