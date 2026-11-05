# P2-3 地图扩层（3 → 5 层 + 主题化 + F4/F5 主题怪 + 通关链迁移）

> 阶段：P2 内容扩量 · 第 3 卡
> 状态：待 Trae 实现
> 素材：28 张已由豆包从 0x72 v1.7 裁入 `assets/sprites/`（big_zombie 32×36 idle 4 帧、necromancer 16×23 4 帧、masked_orc 16×23 idle+run 8 帧、pumpkin_dude 16×23 idle+run 8 帧、angel 16×16 idle 4 帧）

## 一、背景与目标

P1 视觉三卡 + P2-1 怪物 10 种 + P2-2 物品 42 条已推送（`0985cf4`）。地图仍 3 层、无层间视觉区分，通关过早。本卡**扩到 5 层**：新增 F4"冰霜墓穴"与 F5"恶魔深渊"两个主题层，dragon 作为最终层 Boss（通关链后移），每层加入主题色调与装饰权重差异，再加入 5 种 F4/F5 主题怪（怪物 10→15）。

**关键事实**：`js/systems/map.js` 已按 `sizes[floorIndex % len]`、`enemyTable[floorIndex % len]` 取配置、怪物数 `5+floorIndex*2`、**最后一层强制存在 dragon**（`floorIndex === cfg.floors-1`）。因此扩层只需改 `maps.js` 配置与 monster/anim 登记，`map.js` 生成逻辑无需改（除非验证发现越界）。

## 二、素材清单（已就位，勿重裁）

| 组 | 文件 | 尺寸 | 层位 |
|---|---|---|---|
| 大僵尸 | `big_zombie_idle_anim_f0~f3` | 32×36 | F4/F5（单态 4 帧） |
| 死灵法师 | `necromancer_anim_f0~f3` | 16×23 | F4/F5（单态 4 帧） |
| 面具兽人 | `masked_orc_idle/run_anim_f0~f3` | 16×23 | F4 |
| 南瓜怪 | `pumpkin_dude_idle/run_anim_f0~f3` | 16×23 | F4 |
| 天使 | `angel_idle_anim_f0~f3` | 16×16 | F5（单态 4 帧） |

## 三、实现要点

1. **js/data/maps.js**：
   - `floors: 3 → 5`；`sizes` 追加 `[33,21]`、`[37,23]`。
   - `enemyTable` 扩到 5 行（每行概率和=1，逐层期望强度严格递增）：
     - F1 地牢杂兵：slime .45 / bat .3 / goblin .15 / tiny_zombie .1（不变）
     - F2 兽人营地：bat .15 / skeleton .3 / orc_warrior .3 / orc_shaman .25（不变）
     - F3 龙巢前哨：skeleton .3 / ogre .25 / wogol .2 / **imp .25**（dragon 移出，imp 正式独立登场；概率按强度配平，保持 F3 期望仍介于 F2/F4 之间）
     - F4 冰霜墓穴：big_zombie .2 / necromancer .2 / pumpkin_dude .15 / masked_orc .3 / skeleton .15
     - F5 恶魔深渊：dragon .2（map.js 末层强制保底，可与表叠加）/ big_zombie .2 / necromancer .2 / masked_orc .2 / angel .2
   - 新增 `themes`（5 项，纯视觉参数）：
     `[{ name:'地牢', tint:'rgba(120,130,150,0.06)' }, { name:'兽人营地', tint:'rgba(150,120,70,0.08)' }, { name:'龙巢前哨', tint:'rgba(160,60,50,0.10)' }, { name:'冰霜墓穴', tint:'rgba(80,140,200,0.10)' }, { name:'恶魔深渊', tint:'rgba(110,60,160,0.12)' }]`
     可调数值，透明度不超过 0.12 避免压暗贴图。
2. **js/data/monsters.js**：追加 5 种（数值建议，目标 F4 期望≈33~40、F5 期望≈45+，严格递增）：
   - big_zombie：hp 170 / atk 22 / def 10 / exp 55 / gold [26,48] / 掉 potion_large 0.3
   - necromancer：hp 100 / atk 19 / def 6 / exp 42 / gold [20,36] / 掉 potion_mana 0.35
   - masked_orc：hp 105 / atk 19 / def 8 / exp 41 / gold [18,34] / 掉 sword_bone 0.18（带 tiers）
   - pumpkin_dude：hp 110 / atk 18 / def 7 / exp 40 / gold [17,32] / 掉 potion_xl 0.2
   - angel：hp 90 / atk 21 / def 5 / exp 45 / gold [22,40] / 掉 potion_mana 0.3
   - 全部沿用现有 schema（drops 支持 tiers），color 补齐。
3. **js/core/render.js**：
   - `MONSTER_ANIM` 扩到 15 种：big_zombie/necromancer/angel 为**单态**（idle 与 run 同帧组，用 4 帧循环），masked_orc/pumpkin_dude 为 idle+run 双态。
   - `drawMap` 按层叠加主题色调：在绘制完地板墙与装饰后、怪物/玩家之前，用 `MAPS.themes[floor-1].tint` 全屏 `fillRect`（`save/restore` 包裹，不影响 HUD/UI 层）；`themes` 缺失时跳过。
   - 装饰/细节权重可按层微调（可选，不改也行；若改，说明不同层观感差异）。
4. **js/systems/map.js**：默认不改。若楼层索引越界（`floorIndex >= cfg.floors` 时 stairs 仍可下），需在同一处加保护：最后一层楼梯改判定为"通关/不可下"，并说明处理方式。
5. **js/data/quests.js**：`main_clear_dragon` 判定（kill dragon×1）逻辑不变；若任务描述文本含"三层/3 层"字样需同步改为"地牢深处"。
6. **js/core/sprites.js**：NAMES 追加 28 张；FRAME_SETS 追加 `big_zombie_idle`、`necromancer`、`masked_orc_idle/run`、`pumpkin_dude_idle/run`、`angel_idle`。
7. **bestiary**：自动扩 15 种怪（无需改）。

## 四、硬性约束

- 原生 JS + Canvas，零构建，file:// 可玩；不引新库。
- 战斗公式/升级曲线/装备体系/任务判定逻辑不改（描述文本可改）。
- 素材不重裁不改名；Sprites 接口不变；MAPS 现有字段名不删（新增 themes 为增量）。
- 每层 enemyTable 概率和=1；五层期望强度严格单调递增。

## 五、完成标准

1. 列出改动文件清单。
2. 新建 `preflight/verify_p2_3.html`（R-01 模板 + 包装 drawImage/fillRect 记录法），断言：
   - t2_floors：`MAPS.floors=5`、`sizes.length=5`、`enemyTable.length=5`、每层概率和=1
   - t3_strength：五层期望强度严格递增（输出 f1~f5 数值）
   - t4_monster15：MONSTERS 含 15 种；MONSTER_ANIM 覆盖 15 种且帧组非 null
   - t5_drawMap：F4 虚拟地图放 big_zombie/necromancer/masked_orc/pumpkin_dude 各一格、F5 放 angel 一格，drawMap 落笔对应 `*_anim_f*` 前缀
   - t6_theme：F4 地图 drawMap 后（或经公开接口读取）主题 tint 被使用（记录 fillRect 的 rgba 参数），F1 与 F4 tint 不同
   - t7_floorSwitch：Map.floorIndex 从 1 切到 5 再切回，无越界、地图尺寸与表项匹配
   - t8_dragonFinal：末层（F5）生成后存在 dragon（map.js 强制逻辑生效）
   - t9_fallback：素材缺失/未知 id 回退不抛错
   - 输出 `PASS {"mapLoaded":true,"mapApi":true,"mapOk":true}` + 子断言
3. **verify_m8_6 同步**：t6_table 期望强度改 5 层（列新旧对比）；t7_nogrind 通关模拟按 5 层重新计算（怪物数 F1=7…F5=13，总经验更大），断言目标（L4+ 装备打 dragon 伤害/总经验够升级）如不再成立，需说明并给出新口径（例如改为 L5 或调整断言）。
4. **verify_p2_1 同步**：t3_floorTable 若断言 `enemyTable.length=3` 需改为 5，并保持概率和/单调/dragon 位置断言（dragon 现只在 F5）。
5. index.html 冒烟无 JS 错误；全量回归全 PASS 或说明受影响原因。
6. 说明剩余风险点。

## 六、验证命令

项目根新建 `preflight/verify_p2_3.html`（R-01：加载顺序同 index.html、IIFE try/catch、title+body 各输出一次 PASS JSON）。Edge file:// 打开看 Console。全量回归沿用既有页清单。

## 七、风险点（已知）

- 5 层后单局时长显著变长（F5 才见 dragon），属作品级预期；若试玩嫌长，可把 F5 尺寸缩小或怪数上限钳制。
- 主题 tint 用近似色叠加可能使贴图偏色（尤其冰蓝/紫），透明度需实测微调。
- `count = 5+floorIndex*2` 在 F5 = 13 怪，配合大尺寸地图（37×23）会出现拥挤或性能压力；若掉帧需说明实测结果。
- 单态怪（big_zombie/necromancer/angel）只有 idle 循环，追击时无 run 帧，观感为"滑行追击"；素材限制，已知取舍。
