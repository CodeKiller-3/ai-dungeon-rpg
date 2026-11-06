# P2-4 BOSS 扩量（1 → 3：F2 独眼酋长 / F4 僵尸王 / F5 地牢巨龙）

> 阶段：P2 内容扩量 · 第 4 卡
> 状态：待 Trae 实现
> 素材：零新增（复用已在库的 ogre 32×36 idle+run、big_zombie 32×36 idle、big_demon 32×36 idle+run）

## 一、背景与目标

当前只有 dragon 一个 Boss（F5），中途全是普通怪，节奏平。本卡给 **F2、F4 各加一只层 Boss**，形成"3 个 Boss 节点"结构：
- **F2 独眼酋长（ogre_boss）**：兽人营地的首领，视觉复用 ogre 大图
- **F4 僵尸王（zombie_king）**：冰霜墓穴的主宰，视觉复用 big_zombie 大图
- **F5 地牢巨龙（dragon）**：最终 Boss，已有

三个 Boss 各有狂暴二阶段 + 专属技能（enrage 结构 `battle.js` 已通用化，读 `monster.enrage`，无需改战斗逻辑）。地图生成改为**每层配置式 Boss 保底**（替换末层硬编码 dragon 逻辑），普通怪表不出现 Boss id，Boss 全图唯一。

## 二、素材清单（零新增，勿裁）

| Boss | 素材组 | 尺寸 | 形态 |
|---|---|---|---|
| ogre_boss | `ogre_idle/run_anim_f0~3` | 32×36 | 双态 |
| zombie_king | `big_zombie_idle_anim_f0~3` | 32×36 | 单态 |
| dragon | `big_demon_idle/run_anim_f0~3` | 32×36 | 双态（已有） |

## 三、实现要点

### 1. js/data/monsters.js — 新增 2 个 Boss（不删改现有 16 种）
```js
ogre_boss: {
  id: 'ogre_boss', name: '独眼酋长', boss: true,
  hp: 280, atk: 24, def: 10, exp: 130, gold: [60, 110],
  drops: [{ itemId: 'sword_steel', rate: 0.5, tiers: [{itemId:'sword_steel',w:60},{itemId:'sword_steel_rare',w:30},{itemId:'sword_steel_epic',w:10}] },
          { itemId: 'chain_mail', rate: 0.3 }],
  enrage: { hpPct: 0.5, atkMul: 1.4, defMul: 1.2,
            skill: { name: '战吼重击', chance: 0.35, dmgMul: 1.5 } },
  color: '#c08a3e'
}
zombie_king: {
  id: 'zombie_king', name: '僵尸王', boss: true,
  hp: 420, atk: 30, def: 12, exp: 200, gold: [90, 160],
  drops: [{ itemId: 'plate_armor', rate: 0.4 },
          { itemId: 'potion_xl', rate: 0.5 }],
  enrage: { hpPct: 0.5, atkMul: 1.35, defMul: 1.25,
            skill: { name: '腐毒吐息', chance: 0.3, dmgMul: 1.4 } },
  color: '#6fae6f'
}
```
- dragon 追加 `boss: true`（仅标记，数值不动）。
- 掉落 id 均为 P2-2 已存在的物品（`sword_steel` 及其 rare/epic、`chain_mail`、`plate_armor`、`potion_xl`），需与 items.js 逐一对齐。

### 2. js/data/maps.js — 新增 Boss 配置
- 新增 `bosses: [{ floor: 2, id: 'ogre_boss' }, { floor: 4, id: 'zombie_king' }, { floor: 5, id: 'dragon' }]`（floor 为 1-based 层号）。
- `enemyTable` 五层保持不含 Boss id（现有表已满足）。
- 可选：`themes` 中 F2/F4 增加 boss 层标记（不必）。

### 3. js/systems/map.js — Boss 保底通用化
在 `spawnEnemies()` 末尾统一处理（合并现有末层 dragon 逻辑，不保留两套）：
1. 读取本层 Boss：`var bossId = null; for (var b = 0; b < cfg.bosses.length; b++) if (cfg.bosses[b].floor === floorIndex + 1) bossId = cfg.bosses[b].id;`
2. 若 `bossId` 为空 → 不处理（普通层）。
3. 若有 → 统计当前敌人中该 id 数量：
   - 0 只：替换末位为 `bossId`（敌人非空）；若敌人为空则忽略（极端情况）。
   - 1 只：不动。
   - >1 只：保留第一只，其余替换为本层表中非 Boss 的随机 id（与 P2-3b 逻辑同构）。
4. Boss 唯一性保证：普通敌表不含 Boss id 前提下，本层只会由本函数注入 1 只。
5. `verify_p2_3` 的末层 dragon 断言（恰 1 只）必须继续成立。

### 4. js/core/render.js — Boss 视觉强化（轻量）
- `MONSTER_ANIM` 追加 `ogre_boss`（复用 ogre 帧组）、`zombie_king`（复用 big_zombie 帧组）。
- `drawBattle`：Boss（`monster.boss === true` 或 id 在 Boss 集合）绘制放大 1.2~1.3 倍（保持比例，不越面板）、名字行前缀 `【BOSS】`、血条用更醒目描边（可选）。
- 地图上的 Boss：格子内可加轻微标记（如边框/头顶小标记），可选，不影响功能。

### 5. js/systems/modal.js — 图鉴标记（可选）
- 怪物图鉴页中 Boss 名称前显示 `★`，不改行结构。

## 四、硬性约束

- **不改战斗公式与 enrage 机制**（`battle.js` 一行不动，除非验证发现 Boss 特化必需）；不改升级曲线；不改装备/物品数据；素材不动；F1~F5 普通怪数值不动。
- 每层 Boss 数量恰为 1（有 Boss 配置的层）；普通层 0；普通怪表不出现 Boss id。
- file:// 零构建可玩；不引新库。

## 五、完成标准

1. 改动文件清单。
2. 新建 `preflight/verify_p2_4.html`（R-01 模板），断言：
   - t2_bossData：MONSTERS 含 18 种；ogre_boss/zombie_king/dragon 均有 `boss:true`、`enrage`（hpPct/atkMul/defMul/skill 齐全）、hp/atk/def/exp 正数
   - t3_bossConfig：`MAPS.bosses` 长度 3，floor 2/4/5 各对应 ogre_boss/zombie_king/dragon；五层 enemyTable 均不含任何 Boss id
   - t4_spawnEvery：F2 连续生成 20 次，每次 ogre_boss 恰 1 只；F4 每次 zombie_king 恰 1；F5 每次 dragon 恰 1；F1/F3 每次 0
   - t5_enrage：模拟 ogre_boss 受击至 hp ≤ 50% → `state.enraged=true`、`enrageAtk=round(24×1.4)=34`、`enrageDef=round(10×1.2)=12`；zombie_king 同理（30×1.35=41 / 12×1.25=15）
   - t6_battleDraw：`drawBattle` 遇 ogre_boss 落 `ogre_*_anim_f*`、遇 zombie_king 落 `big_zombie_idle_anim_f*`、遇 dragon 落 `big_demon_*`
   - t7_drops：Boss 掉落 id 全部存在于 ITEMS（sword_steel/chain_mail/plate_armor/potion_xl 及其变体）
   - t8_fallback：未知 Boss id / 素材缺失不抛错
   - 输出 `PASS {"bossLoaded":true,"bossApi":true,"bossOk":true}` + 子断言
3. 受影响的既有页同步：`verify_p2_3`（t5_oneDragon/t8 若与新逻辑耦合）、`verify_p1p2`（末层 13 怪 1 龙）、`verify_m8_6`（t7_nogrind 若受 Boss exp 影响，需复算并输出新旧对比）、`verify_p2_1`（怪物数 16→18 若断言了数量）。
4. index.html 冒烟 0 JS 错误；全量回归全 PASS。
5. 剩余风险点。

## 六、验证命令

项目根新建 `preflight/verify_p2_4.html`（R-01：加载顺序同 index.html、IIFE try/catch、title+body 各输出一次 PASS JSON）。Edge file:// 打开看 Console。全量回归沿用既有页清单（当前 30 页）。

## 七、风险点（已知）

- Boss 与普通怪共用大图素材（ogre/big_zombie），图上可能"看起来一样只是数值强"；靠名字/BOSS 标记/放大 1.2 倍区分。
- F2 Boss hp 280 对 2 层玩家（atk≈15）可能偏肉，若试玩觉得拖，可降到 240。
- F4 Boss hp 420 配 13 只怪地图，单场可能 8~12 回合；数值可在试玩后调。
- 图鉴新增 2 条（18 种）滚动窗口已支持，无需改。
- enrage 技能复用现有"烈焰吐息"实现路径（技能名不同但机制相同），若需要技能差异化（如僵尸王吐息带减速）超出本卡范围。
