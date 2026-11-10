# C-04 物品扩充：恢复 F4 轮换池为 5 件

> 卡号：C-04（C-03b 的收口卡）
> 前置：C-03b 已交付 `273704e`（轮换池不得售卖更深层核心货；F4 池长降为 4）
> 代码基线：`273704e`；本卡完成后基线升至本卡 commit

## 一、玩家可见行为

- 商店轮换位新增两件装备：**骑士长剑**（`weapon`，240 金，atk+9）、**鳞甲**（`armor`，240 金，def+5 / maxHp+10）；两件均为纯数值装备，不带任何新机制（无吸血/反弹/暴击/触发类效果）。
- F4 轮换池由 4 项恢复为 5 项：`sword_bone_epic`(240) / `armor_leather_epic`(320) / `sword_anime`(260) / `sword_knight`(240) / `armor_scale`(240)；开张周期恢复为 5 次。F4 首次开张（`(4×3+0)%5=2`）即展示 `sword_anime` + `sword_knight`，第二次开张展示 `sword_knight` + `armor_scale`——新装备两次开张内可见。
- F4 货架合计仍为 11 条（核心 8 + 轮换 2 + 卷轴 1），弹窗行数与滚动行为不变。
- 其余四层池、核心货架、卷轴、所有既有物品的价格与效果均不变；买价严格高于卖价、同层同次开张稳定、换层归零可复现均不变。

## 二、改动范围

| 文件 | 改动 |
|---|---|
| `js/data/items.js` | 新增 2 件装备（插在 `robe_mage_epic` 之后、`potion_xl` 之前，保持图鉴末条仍为 `scroll_upgrade_4`）；F4 轮换池补到 5 项（移除重复定位的 `sword_iron_epic`，它仍在 F3 池）；注释改回"五层各 5 项"。价格表、`SHOP_STOCK`、`SHOP_SCROLLS` 未动。 |
| `preflight/verify_c04.html` | 新建，断言 C4-1~C4-9。 |
| `preflight/verify_c03.html` | C3-2 池长/周期期望 `5,5,5,4,5` → `5,5,5,5,5`；C3-6 校验和 46/9685/4841 → 48/10165/5081（规格变更，见 §四）。 |
| `preflight/verify_c03b.html` | C3b-3 池长/周期期望 → `5,5,5,5,5`；C3b-4 校验和 → 48/10165/5081 与新哈希；C3b-7 文档口径改为"README 五层各 5 项、规划含 C-04 且标记已闭合"。 |
| `preflight/verify_p2_3b.html` | 图鉴物品页条数 46 → 48、`sel` 末条 45 → 47（`scroll_upgrade_4` 仍是末条）。 |
| `README.md` / `docs/答辩讲稿.md` | 轮换池"F4 为 4 项 / 4 次一循环"改回"F1~F5 各 5 项、5 次一循环"；README 补"物品全表 48 件"（用"件"而非"条"，避免 `selfcheck` XC-01 正则 `物品.{0,8}(\d+)\s*条` 对多位数贪婪截成末位数字的误判）。 |
| `规划-对标补齐.md` | §七 新增 C-04 落地口径；C-03b 的"F4 池长 4"缺口标记已闭合；§八 基线刷到 43/43。 |

### 新增物品完整字段

| id | name | type | price | sell | effect |
|---|---|---|---|---|---|
| `sword_knight` | 骑士长剑 | `weapon` | 240 | 120 | `{ atk: 9 }` |
| `armor_scale` | 鳞甲 | `armor` | 240 | 120 | `{ def: 5, maxHp: 10 }` |

校验：`type` 合法、`price ≥ 240`、`sell = floor(price/2)`、id 与现有 46 件无冲突、均不在 F4 核心（`potion_xl`/`potion_mana`/`sword_magic_rare`/`sword_steel_epic`/`chain_mail_rare`/`plate_armor_rare`/`robe_mage_rare`/`sword_dragon_rare`）与 F5 核心（`potion_xl`/`potion_mana`/`sword_magic_epic`/`sword_dragon_epic`/`plate_armor_epic`/`chain_mail_epic`/`robe_mage_epic`/`sword_dragon_rare`）货架内；无新增素材引用（`modal.js` 的 `itemIcon` 未映射的 id 返回 `null`，走纯文本渲染路径）。

### 同价位（240~320）平衡对比表

| 类型 | 既有参照物（价格 / 效果） | 区间上限 | 新增项 | 判定 |
|---|---|---|---|---|
| weapon | `sword_bone_epic` 240 / atk6+maxHp10；`sword_iron_epic` 240 / atk6+maxHp10；`sword_anime` 260 / atk12；`sword_dragon_rare` 300 / atk12；`sword_magic_rare` 320 / atk12 | atk ≤ 12、maxHp ≤ 10 | `sword_knight` 240 / atk9 | atk9 ≤ 12（低于上限 3 点） |
| armor | `chain_mail_rare` 240 / def8；`robe_mage_rare` 300 / def6+maxHp10；`armor_leather_epic` 320 / def6+maxHp10 | def ≤ 8、maxHp ≤ 10 | `armor_scale` 240 / def5+maxHp10 | def5 ≤ 8（低于上限 3 点）、maxHp10 = 10（等于上限，未超） |

不引入新机制：两项 `effect` 只使用既有白名单键 `atk` / `def` / `maxHp`（`verify_p2_2` 的 `VALID_EFFECT` 与 `selfcheck` DC-01 同口径）。
不构成严格支配：`sword_knight`(240, atk9) 与同价 `sword_bone_epic`/`sword_iron_epic`(240, atk6+maxHp10) 是"攻高 / 带血"的互换关系；`armor_scale`(240, def5+maxHp10) 与同价 `chain_mail_rare`(240, def8) 是"血厚 / 纯防"的互换关系，均不优于 F4 核心的更高价位货（`sword_magic_rare` 320 atk12、`robe_mage_rare` 300 def6+maxHp10）。

## 三、不许动

- `Battle` 伤害公式、怪物数值、Boss 二阶段、五层期望强度基线（11.125 / 20.125 / 23.75 / 36.85 / 44.1）、楼层数 5。
- 存档键名 `ai_dungeon_rpg_save_v1` 与存档字段（本卡不新增字段：新物品只按 id 进背包/图鉴，两者都是既有 map 结构）。
- `MAX_VISIBLE`、弹窗字号与行高规则。
- 任何既有物品的 `price` / `sell` / `effect`；`SHOP_STOCK` 内容与条数（7/9/9/8/8）；`SHOP_SCROLLS`；`SHOP_ROTATION` 取模规则（`(楼层×3 + 开张次数) % 池长`）；F1/F2/F3/F5 池内容。

## 四、断言表（`preflight/verify_c04.html`）

| 编号 | 名称 | 判定口径 |
|---|---|---|
| C4-1 | `newItemsValid` | 两件新物品逐项：`type ∈ {weapon,armor}`、`price ≥ 240`、`sell = floor(price/2)` 且 `price > sell`、id 与既有 46 件不冲突、不在 F4/F5 核心、`effect` 键在白名单内、atk ≤ 12 / def ≤ 8 / maxHp ≤ 10（区间上限由既有 240~320 装备实测得出） |
| C4-2 | `poolRestored` | 池长 `[5,5,5,5,5]`、周期 `[5,5,5,5,5]` |
| C4-3 | `noDeeperCoreInPool` | 五层"池内装备 ∩ 更深层核心"违规数组全空（沿用 C3b-1 口径） |
| C4-4 | `tierStillOk` | 五层核心非消耗品最低价真值 20 / 85 / 150 / 240 / 300，池内装备低于下界违规 0 |
| C4-5 | `countsUnchanged` | 核心 `[7,9,9,8,8]`、合计 `[10,12,12,11,11]` |
| C4-6 | `pricesIntactAndExtended` | 既有 46 件（显式 id 列表）逐项：Σprice 9685、Σsell 4841、`price > sell` 违规空、FNV-1a `id:price:sell`（排序、`;` 连接）哈希 = `9a01bb60`；新增 2 件单列输出（240/120 ×2） |
| C4-7 | `poolIdsDistinct` | 五层池集合两两不同 |
| C4-8 | `stableStock` | 同层同次开张两次 `getStock` 一致；整周期后回到首相位；换层归零可复现 |
| C4-9 | `docsConsistent` | file XHR 读取 README / 本卡 / 规划文档：README 含"F1~F5 各 5 项"、不含"F4 为 4 项"、若声明物品条数须等于实测 48；规划含 C-04 的 `48` / `10165` / `5081` / `43/43` 且 C-03b 缺口标记"已闭合" |

### 关于既有断言的规格变更（逐条）

1. `verify_c03` C3-2：池长/周期原为 `5,5,5,4,5`（C-03b 妥协态），本卡恢复 `5,5,5,5,5`；判定逻辑不变。
2. `verify_c03` C3-6：`46 / 9685 / 4841` → `48 / 10165 / 5081`（新增 240+240 价格、120+120 卖价）；`price > sell` 与抽查项不变。
3. `verify_c03b` C3b-3：同 C3-2，池长/周期 → `5,5,5,5,5`。
4. `verify_c03b` C3b-4：全表条数与校验和随新增项更新为 `48 / 10165 / 5081` + 新哈希；"既有 46 件不变"的证明移交 C4-6（显式列表 + 原哈希 `9a01bb60`），C3b-4 只保留"全表现状校验和"职能。
5. `verify_c03b` C3b-7：原断言"README 含 F4 为 4 项、规划含该缺口"是本卡之前的口径，现已过时；改为"README 五层各 5 项、规划含 C-04 且缺口已闭合"。
6. `verify_p2_3b` t4：图鉴物品页条数 46 → 48、末条选中位 45 → 47（末条仍是 `scroll_upgrade_4`，插入点上移不影响末条）。

`verify_p2_2` 的 `t2_itemCount` 只要求 `>= 40`、`verify_c02` 的 C2-3 只要求池长 `>= 4`，均无需改动。

## 五、完成定义

1. `node --check js/data/items.js` 通过。
2. `verify_c04` 单页 PASS（C4-1~C4-9 全 true）。
3. `run-all.ps1 -Budget 3500`：TOTAL=43 / PASS=43 / FAIL=0 / NONE=0 / MIXED=0。
4. `selfcheck.js` 0 FAIL（无新增 WARN）。
5. 1280×800 实机截图：F4 商店面板的轮换位可见新装备（骑士长剑 / 鳞甲）。
6. 一个含 C-04 的 commit 推送；按 §6.1-2 用 `?v=<commit>` 核验，不通如实写"线上未核验"。

## 六、取舍与已知缺口

1. **F4 池由 4 恢复 5、周期回到 5**：合格候选变为 6 件（原 4 + 新 2），按"池长必须为 5"取 5 件；移除与 `sword_bone_epic` 数值完全重复的 `sword_iron_epic`（它仍保留在 F3 池，不丢失展示），保留高攻的 `sword_anime` 与两件新装备。
2. **F3 及其他层未补位**：F1~F3、F5 池本就各 5 项，无空缺；按"不越层、不破坏合集互异"原则不加货（加货会改变周期与展示条数）。
3. **DC-01 基线不受影响**：五层期望强度基线由 `verify_m8_6` 用怪物数值与玩家成长曲线复算，全程不读 `ITEMS` 表（该页未加载 `js/data/items.js`）；新物品只出现在商店与图鉴，不进入任何影响期望强度的路径，故 11.125 / 20.125 / 23.75 / 36.85 / 44.1 不变。
4. **展示余量仍为零**：F2/F3 合计 12 条 = `MAX_VISIBLE`（12），本卡未加核心货、未改轮换位数量，F4 合计仍 11 条，未触碰该天花板。
5. **新装备无图标**：`modal.js` 的 `itemIcon` 只映射既有 id，未映射项返回 `null`、行走纯文本渲染——符合"不新增未注册素材引用"的约束；若后续要做图标，复用已注册素材名即可。
