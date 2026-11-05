# P2-2 物品扩量（11 → 40+：多武器体系 + 护甲阶梯 + 药水分层 + 商店重配）

> 阶段：P2 内容扩量 · 第 2 卡
> 状态：待 Trae 实现
> 素材：18 张已由豆包从 0x72 v1.7 裁入 `assets/sprites/`（weapon_anime_sword / baton_with_spikes / big_hammer / bow_2 / double_axe / cleaver / duel_sword / green_magic_staff / hammer / katana / knife / knight_sword / mace / saw_sword / machete / red_magic_staff / waraxe / throwing_axe；P1-2 已裁 rusty/regular/golden/red_gem/lavish/axe/bow/spear 8 把）

## 一、背景与目标

P2-1 怪物已扩到 10 种。当前物品仅 11 条（3 药水 + 2 武器 + 1 护甲 + 5 品质变体），商店 3 层货架重合度高，武器选择面小。本卡**扩到 40+ 条**：武器体系化（约 24 把，含剑/斧/弓/枪/锤/匕首/法杖，逐层解锁、数值阶梯）、护甲 8 件（皮/链/板/袍 + 品质档）、药水 5 种（新增特大血瓶与蓝瓶）、商店三层货架重配。**保持现有两装备槽（weapon/armor）与 effect 体系（atk/def/maxHp/hp/mp），不新增槽位与效果类型**；蓝瓶需要 inventory.use 支持 `effect.mp`（一处小扩展）。

## 二、素材清单（已就位，勿重裁）

18 张新武器图标 + P1-2 已裁 8 把 = 26 把全覆盖。护甲无独立图标（0x72 无护甲图），护甲行沿用 P1-2 itemIcon 白名单现状（不画图标）。

## 三、实现要点

1. **js/data/items.js**：`Game.Data.ITEMS` 扩到 40+ 条（保留现有 11 条不动）：
   - **武器体系**（type:'weapon'，effect.atk 阶梯，价格≈atk×20、sell=price/2 取整）：
     - 1 层：sword_rusty（生锈短剑 atk+1，30g，复用 weapon_rusty_sword 图标）、knife（匕首 atk+1 低价 20g）、machete（砍刀 atk+2 45g）、sword_iron（铁剑 atk+3 60g）
     - 2 层：sword_steel（钢剑 atk+5 100g）、axe_war（战斧 atk+6 120g，weapon_waraxe）、bow_hunter（猎弓 atk+4 90g，weapon_bow_2）、hammer（战锤 atk+4 85g）、spear（长矛 atk+4 90g）
     - 3 层：sword_magic（魔剑 atk+8 160g，weapon_knight_sword）、staff_fire（烈焰法杖 atk+9 180g，weapon_red_magic_staff）、bow_elite（精弓 atk+7 140g，weapon_bow）、axe_double（双刃斧 atk+10 200g，weapon_double_axe）、sword_anime（妖刀 atk+12 260g，weapon_anime_sword）
     - 品质档：sword_iron_rare/epic、sword_steel_rare/epic、sword_magic_rare/epic 按 M8-3 公式（rare=round(atk×1.5)×2 价、epic=round(atk×2)+maxHp:10 ×4 价）——数量自控，达到 40+ 即可
   - **护甲体系**（type:'armor'，effect.def 阶梯）：chain_mail（锁链甲 def+5 120g）、plate_armor（板甲 def+8 200g）、robe_mage（法袍 def+4 maxHp+10 150g）+ 各自 rare/epic（按 M8-3 公式）
   - **药水**（type:'consumable'）：potion_xl（特大血瓶 effect:{hp:150} 80g）、potion_mana（蓝瓶 effect:{mp:40} 35g）
   - 命名约定：id 用 snake_case，name 中文；effect 仅 atk/def/maxHp/hp/mp 五键。
2. **js/systems/inventory.js**：`use` 增加 `effect.mp` 分支（`p.mp = Math.min(p.mp + mpGain, p.maxMp)`，与 hp 同构）；其余不动。蓝瓶在 MP 已满时可拒绝使用（提示）。
3. **js/data/items.js SHOP_STOCK**：三层重配（每层 6~9 种，按楼层解锁递进，含药水/武器/护甲）：
   - F1：potion_small / potion_large / knife / machete / sword_rusty / sword_iron / armor_leather
   - F2：potion_large / potion_mana / sword_steel / axe_war / bow_hunter / hammer / spear / chain_mail / robe_mage
   - F3：potion_xl / potion_mana / sword_magic / staff_fire / bow_elite / axe_double / sword_anime / plate_armor / sword_dragon 系列（保留 3 档）
4. **js/systems/modal.js**：`itemIcon` 白名单扩展——新武器 id → 对应图标名（sword_rusty→weapon_rusty_sword、knife→weapon_knife、machete→weapon_machete、sword_iron→weapon_regular_sword、sword_steel→weapon_duel_sword、axe_war→weapon_waraxe、bow_hunter→weapon_bow_2、hammer→weapon_hammer、spear→weapon_spear、sword_magic→weapon_knight_sword、staff_fire→weapon_red_magic_staff、bow_elite→weapon_bow、axe_double→weapon_double_axe、sword_anime→weapon_anime_sword、品质变体→基础档图标）；护甲仍不画（或可选加盾牌占位，自行决定并说明）。
5. **js/core/sprites.js**：NAMES 追加 18 张武器图标。
6. **掉落微调（可选）**：P2-1 新怪掉落可换新物品（如 orc_warrior 掉 axe_war、wogol 掉 sword_steel、ogre 掉 staff_fire），保持各层掉落强度与商店一致；改后同步怪物数值合理性即可。
7. **图鉴**：确认物品图鉴列表来源（遍历 ITEMS 或仅已收录），新增物品显示行为说明；无需改逻辑。

## 四、硬性约束

- 原生 JS + Canvas，零构建，file:// 可玩；不引新库。
- 装备槽/effect 体系不扩展（仅 use 加 mp 分支）；M8-3 品质公式不变；M8-6 升级曲线不变。
- 素材不重裁不改名；Sprites 接口不变；Game.Data.ITEMS 现有 11 条不删不改。

## 五、完成标准

1. 列出改动文件清单。
2. 新建 `preflight/verify_p2_2.html`（R-01 模板 + 包装 drawImage 记录法），断言：
   - t2_itemCount：ITEMS 条目 ≥40，type 均合法，effect 键仅 atk/def/maxHp/hp/mp
   - t3_weaponTier：武器 atk 阶梯非降（按楼层分组），护甲 def 阶梯非降
   - t4_shopStock：SHOP_STOCK 长度=3，每层条目数 6~9，F1 不含 F3 专属武器
   - t5_useMp：装备蓝瓶后 use 回蓝 40 且不超 maxMp；满 MP 拒绝
   - t6_itemIcon：新武器在弹窗物品行落笔对应图标（包装 drawImage 记录含 weapon_*）
   - t7_fallback：未知物品/素材缺失不抛错
   - t8_recalc：装备 sword_steel+chain_mail 后 atk/def 正确叠加（含等级基础）
   - 输出 `PASS {"itemLoaded":true,"itemApi":true,"itemOk":true}` + 子断言
3. index.html 冒烟无 JS 错误；全量回归全 PASS 或说明受影响原因。
4. 说明剩余风险点。

## 六、验证命令

项目根新建 `preflight/verify_p2_2.html`（R-01：加载顺序同 index.html、IIFE try/catch、title+body 各输出一次 PASS JSON）。Edge file:// 打开看 Console。全量回归沿用既有页清单。

## 七、风险点（已知）

- 商店货架变长（9 项）后，商店弹窗若按固定行高绘制可能放不下——需检查 modal 列表滚动/换页逻辑，放不下时说明处理方式（截断/滚动）。
- 武器 20+ 把后，掉落/商店可能出现"低阶武器占位"问题；靠逐层解锁控制。
- 蓝瓶引入后战斗 MP 续航变化，属玩法微调；若担心失衡，价格可调（卡内可改）。
- itemIcon 白名单 20+ 条映射需与 ITEMS 逐一核对，漏映射的武器行无图标（不报错）。
