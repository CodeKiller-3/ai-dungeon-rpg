# P2-1 怪物扩量（4 → 10 种，三层多样性与数值曲线）

> 阶段：P2 内容扩量 · 第 1 卡
> 状态：待 Trae 实现
> 素材：48 张已由豆包从 0x72 v1.7 裁入 `assets/sprites/`（goblin/tiny_zombie/orc_warrior/orc_shaman/wogol 各 idle+run 8 帧、ogre 32×36 idle+run 8 帧；imp 帧 P1-3 已有）

## 一、背景与目标

P1 视觉重做三卡完成（`9acc4a3`/`0810301`/`f13546e`）。当前怪物仅 4 种（slime/bat/skeleton/dragon），且 slime/bat 在 1、2 层重复出现。本卡**扩到 10 种**：新增 goblin/tiny_zombie/orc_warrior/orc_shaman/wogol/ogre 六种（imp 已备不新增出现位或 2-3 层加入），按三层主题分布，期望强度保持单调递增（M8-6 曲线不破坏）。**纯内容加法：不改战斗公式、不改技能/掉落结构（新增怪可按现有 drops 格式配掉落）、dragon 仍在 3 层。**

## 二、素材清单（已就位，勿重裁）

| 组 | 文件 | 尺寸 | 层位 |
|---|---|---|---|
| 哥布林 | `goblin_idle/run_anim_f0~f3` | 16×16 | 1 层 |
| 小僵尸 | `tiny_zombie_idle/run_anim_f0~f3` | 16×16 | 1 层 |
| 兽人战士 | `orc_warrior_idle/run_anim_f0~f3` | 16×23 | 2 层 |
| 兽人萨满 | `orc_shaman_idle/run_anim_f0~f3` | 16×23 | 2 层 |
| 兽人沃古尔 | `wogol_idle/run_anim_f0~f3` | 16×23 | 2-3 层 |
| 食人魔 | `ogre_idle/run_anim_f0~f3` | 32×36 | 3 层 |
| 小恶魔 | `imp_idle/run_anim_f0~f3`（P1-3 已有） | 16×16 | 2-3 层 |

## 三、实现要点

1. **js/data/monsters.js**：`Game.Data.MONSTERS` 追加 6 种（imp 若 P2-1 加出现位则一并登记，或留 P2-3）：
   - 数值建议（可微调，目标：1 层期望 < 2 层 < 3 层，与现有 slime/bat/skeleton/dragon 兼容）：
     - goblin：hp 45 / atk 7 / def 3 / exp 14 / gold [4,10] / 掉 potion_small 0.25
     - tiny_zombie：hp 50 / atk 8 / def 2 / exp 16 / gold [5,12] / 掉 potion_small 0.2
     - orc_warrior：hp 85 / atk 14 / def 6 / exp 30 / gold [12,24] / 掉 sword_bone 0.12（可带 tiers，同 skeleton 格式）
     - orc_shaman：hp 75 / atk 16 / def 4 / exp 32 / gold [14,26] / 掉 potion_large 0.2
     - wogol：hp 95 / atk 17 / def 7 / exp 38 / gold [16,30] / 掉 sword_bone 0.15
     - ogre：hp 130 / atk 20 / def 9 / exp 45 / gold [22,40] / 掉 sword_dragon 0.2
   - color 字段按现有风格补充（视觉色块兜底用）。
2. **js/data/maps.js**：`enemyTable` 三层各扩为 3~4 种（保持每层概率和为 1）：
   - 1 层：slime 0.45 / bat 0.3 / goblin 0.15 / tiny_zombie 0.1
   - 2 层：bat 0.15 / skeleton 0.3 / orc_warrior 0.3 / orc_shaman 0.25
   - 3 层：skeleton 0.3 / dragon 0.25 / imp 0.2 / ogre 0.25（wogol 可选 0.1，自行配平）
   - **硬性要求**：逐层期望强度（按现有验证口径，如 hp/atk 加权）严格单调递增，且 dragon 仍只在 3 层出现（通关链不变）。
3. **js/core/render.js**：怪物视觉映射**集中化**——新增 `MONSTER_ANIM` 映射表（置于模块顶层）：
   `{ slime:'tiny_slug', bat:'imp', skeleton:'skelet', dragon:'big_demon', goblin:'goblin', tiny_zombie:'tiny_zombie', orc_warrior:'orc_warrior', orc_shaman:'orc_shaman', wogol:'wogol', ogre:'ogre' }`
   - drawMap 埋伏/巡逻两路与 drawBattle：改为查表取 `{idle, run}` 帧组（ogre 32×36 走 P1-3 的 drawSpriteByHeight 高适配），未知 id 回退 chort（现状）。
   - 现有 P1-1/P1-3 的 skeleton/slime/bat/dragon 分支行为不变（同 id 同帧组），仅代码收敛。
4. **js/core/sprites.js**：NAMES 追加 48 张；FRAME_SETS 追加 `goblin_idle/run`、`tiny_zombie_idle/run`、`orc_warrior_idle/run`、`orc_shaman_idle/run`、`wogol_idle/run`、`ogre_idle/run`。
5. **js/systems/bestiary.js**：无需改（图鉴从 MONSTERS 动态读，新怪自动收录；但确认页面怪物图鉴行渲染不依赖固定数量——只读不改）。

## 四、硬性约束

- 原生 JS + Canvas，零构建，file:// 可玩；不引新库。
- 战斗公式/技能/M8-6 升级曲线/任务判定（main_clear_dragon 等）一律不改；dragon 仍在 3 层。
- 素材不重裁不改名；Sprites 接口不变。
- 每层 enemyTable 概率和必须为 1；期望强度单调递增。

## 五、完成标准

1. 列出改动文件清单。
2. 新建 `preflight/verify_p2_1.html`（R-01 模板 + 包装 drawImage 记录法），断言：
   - t2_monsterData：MONSTERS 含 10 种（4 旧 + 6 新），每项 hp/atk/def/exp 为有效正数
   - t3_floorTable：enemyTable 长度=3，每层概率和=1，dragon 仅出现在 3 层，逐层期望强度严格递增（用与 M8-6 同口径的强度公式计算）
   - t4_animMap：MONSTER_ANIM 覆盖全部 10 种 id，且每帧组经 getFrame 非 null
   - t5_drawMap：虚拟地图放 goblin/tiny_zombie/orc_warrior/orc_shaman/wogol/ogre 各一格，drawMap 记录含各自 `*_anim_f*` 落笔
   - t6_battle：drawBattle 遇 ogre（作为敌）时落 `ogre_*` 帧
   - t7_fallback：未知 id / 素材缺失回退 chort / 色块，不抛错
   - 输出 `PASS {"monsterLoaded":true,"monsterApi":true,"monsterOk":true}` + 子断言
3. **M8-6 回归**：`verify_m8_6.html` 的 t6_table 期望强度断言——enemyTable 已变，**必须同步更新该页硬编码的期望值**（按新表重算填入，或改为相对断言"严格单调递增"），并在交付说明中列出新旧期望值对比。其余断言不受影响。
4. index.html 冒烟无 JS 错误；全量回归全 PASS 或说明受影响原因。
5. 说明剩余风险点。

## 六、验证命令

项目根新建 `preflight/verify_p2_1.html`（R-01：加载顺序同 index.html、IIFE try/catch、title+body 各输出一次 PASS JSON）。Edge file:// 打开看 Console。全量回归脚本沿用 preflight 目录既有页清单。

## 七、风险点（已知）

- 新增怪物进图鉴后，图鉴页"未击杀显示 ???"逻辑按 MONSTERS 遍历——新怪未击杀即显示名称+???，属预期。
- orc/wogol 16×23 与 ogre 32×36 的地图绘制走高适配（P1-3 drawSpriteByHeight），与 16×16 怪基线略有不齐，纯视觉不阻塞。
- 掉落 tiers（rare/epic）若用于新怪，图鉴物品页自动收录新物品 id——物品描述需存在（P2-2 物品扩量前，建议新怪掉落复用现有物品 id：potion_small/potion_large/sword_bone/sword_dragon，避免未定义物品）。
