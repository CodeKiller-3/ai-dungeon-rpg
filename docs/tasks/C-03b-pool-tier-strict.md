# C-03b 轮换池不得提前售卖深层核心货

> 卡号：C-03b（C-03 的收口卡，按规划端选项 C 落地）
> 前置：C-03 已交付 `213c897`（档位五层整平 + 弹窗滚动按可用高度）
> 代码基线：`213c897`；本卡完成后基线升至本卡 commit

## 一、玩家可见行为

- 商店轮换位不再出现"本层买得到、更深层才该卖"的装备：F2 不会刷出 F4 核心的 `chain_mail_rare` / `robe_mage_rare`，F3 不会刷出 F4 核心三件甲与 F5 核心的 `chain_mail_epic`，F4 不会刷出 F5 核心的 `chain_mail_epic` / `robe_mage_epic`。
- F2/F3 轮换位改为同层档位内的装备（`bow_elite`、`armor_leather_rare`、`sword_bone_epic`、`sword_iron_epic`、`armor_leather_epic`、`sword_steel_rare`），价格不变。
- F4 轮换池由 5 项缩为 4 项（`sword_bone_epic` / `sword_iron_epic` / `armor_leather_epic` / `sword_anime`），开张周期由 5 次变 4 次；F4 货架合计仍为 11 条（核心 8 + 轮换 2 + 卷轴 1），玩家看到的条数不变。
- 其余四层池长与周期不变；换层归零、同层同次开张稳定、买价严格高于卖价均不变。

## 二、改动范围

| 文件 | 改动 |
|---|---|
| `js/data/items.js` | `SHOP_ROTATION` 按"不得出现在更深层核心货架"重排：F2 两处、F3 四处、F4 两处移除并按候选替换；F4 池长 5→4；注释记录通用规则与 F4 妥协原因。价格、`SHOP_STOCK`、`SHOP_SCROLLS` 未动。 |
| `preflight/verify_c03b.html` | 新建，断言 C3b-1~C3b-7（含文档一致性检查，file XHR 读取 README / 本卡 / 规划文档）。 |
| `preflight/verify_c03.html` | C3-2 的池长/周期期望由 `5,5,5,5,5` 改为 `5,5,5,4,5`（规格变更，见 §四）。 |
| `README.md` / `docs/答辩讲稿.md` | "每层 5 项轮换池、5 次一循环"改为分层如实表述（F4 为 4 项、周期 4）。 |
| `规划-对标补齐.md` | §七 新增 C-03b 落地口径 + 通用规则 + F4 池长缺口；§八 基线刷到 42/42。 |

### 规则（本卡固化的通用口径）

> 某层轮换池中的 `weapon` / `armor` 项，不得出现在**更深层**的 `SHOP_STOCK` 核心货架中。

同时保留 C-03 的档位口径：装备项单价 ≥ 该层核心非消耗品最低价（20 / 85 / 150 / 240 / 300）。

### 替换明细

| 层 | 原 id（价格） | 新 id（价格） | 替换理由 |
|---|---|---|---|
| F2 | `chain_mail_rare`(240) | `bow_elite`(140) | 原为 F4 核心；新项不在任何核心货架，≥F2 下界 85 |
| F2 | `robe_mage_rare`(300) | `armor_leather_rare`(160) | 原为 F4 核心；新项不在任何核心，≥85 |
| F3 | `chain_mail_rare`(240) | `sword_bone_epic`(240) | 原为 F4 核心；新项不在 F4/F5 核心，≥150 |
| F3 | `sword_magic_rare`(320) | `sword_iron_epic`(240) | 原为 F4 核心；新项不在 F4/F5 核心，≥150 |
| F3 | `plate_armor_rare`(400) | `armor_leather_epic`(320) | 原为 F4 核心；新项不在 F4/F5 核心，≥150 |
| F3 | `chain_mail_epic`(480) | `sword_steel_rare`(200) | 原为 F5 核心；新项不在 F4/F5 核心，≥150 |
| F4 | `chain_mail_epic`(480) | `sword_anime`(260) | 原为 F5 核心；新项不在 F5 核心，≥240 |
| F4 | `robe_mage_epic`(600) | （池长缩为 4，不补位） | 合格候选仅 4 件，无第 5 件可用 |

F4 保留：`sword_bone_epic`(240) / `sword_iron_epic`(240) / `armor_leather_epic`(320) / `sword_anime`(260)。

### 为什么 F4 只能放 4 件

同时满足「`weapon`/`armor`」「`price ≥ 240`」「不在 F5 核心」「不与 F4 核心重复（否则去重后合计掉到 10）」的装备全集只有 4 件：`sword_bone_epic`、`sword_iron_epic`、`armor_leather_epic`、`sword_anime`。其余 ≥240 的装备分别被 F4 核心（`chain_mail_rare`/`sword_magic_rare`/`sword_steel_epic`/`plate_armor_rare`/`robe_mage_rare`/`sword_dragon_rare`）或 F5 核心（`chain_mail_epic`/`robe_mage_epic`/`sword_magic_epic`/`sword_dragon_epic`/`plate_armor_epic`）占用。因此按规划端裁决取选项 C：F4 池长 4。

## 三、不许动

- `Battle` 伤害公式、怪物数值、Boss 二阶段、五层期望强度基线（11.125 / 20.125 / 23.75 / 36.85 / 44.1）、楼层数 5、存档键名 `ai_dungeon_rpg_save_v1`。
- 任何 `price` / `sell`（全表 46 件逐项不变，Σprice 9685 / Σsell 4841）。
- `SHOP_STOCK` 核心货架内容与条数（7/9/9/8/8）；`SHOP_SCROLLS`；`MAX_VISIBLE` 数值与弹窗字号规则。
- `SHOP_ROTATION` 取模规则（`(楼层×3 + 开张次数) % 池长`）；F1 / F5 池内容。
- 效果口径：F1~F3 保留 `potion_mana` 补给；F4/F5 仍只放装备。

## 四、断言表（`preflight/verify_c03b.html`）

| 编号 | 名称 | 判定口径 |
|---|---|---|
| C3b-1 | `noDeeperCoreInPool` | 五层逐层输出违规数组（池内装备 ∩ 更深层核心），要求全为 `[]` |
| C3b-2 | `tierStillOk` | 五层核心非消耗品最低价真值 20 / 85 / 150 / 240 / 300；池内装备低于下界的项为空 |
| C3b-3 | `countsUnchanged` | 核心 `[7,9,9,8,8]`、合计 `[10,12,12,11,11]`、池长 `[5,5,5,4,5]`、周期 `[5,5,5,4,5]` |
| C3b-4 | `pricesIntact` | 46 件、Σprice 9685、Σsell 4841、`price > sell` 违规空；逐项比对方式：对排序后的 `id:price:sell` 串取 FNV-1a 32 位哈希 = `9a01bb60` |
| C3b-5 | `stableStock` | 同层同次开张两次 `getStock` 完全一致；同层整周期序列首尾相同；离开再回该层回到首相位（沿用 C2-6 口径） |
| C3b-6 | `poolIdsDistinct` | 五层池集合两两不同 |
| C3b-7 | `specDeclared` | file XHR 读取文档：本卡含 F4 池长 4 的原因、规划文档含该缺口、README 不含"每层 5 项"且含"F4 为 4 项" |

### 关于 `verify_c03` 的改写

`verify_c03` 的 C3-2 原断言池长/周期为 `5,5,5,5,5`（C-03 时的真值）。本卡按规划端授权的规格变更改为 `5,5,5,4,5`，其余断言（C3-1 档位、C3-3 滚动、C3-4 高视口、C3-5 四类弹窗、C3-6 价格、C3-7 稳定）均数据驱动，未改判定逻辑。`verify_c02` 的 C2-3 只要求池长 ≥4、C2-4 只要求周期 = 池长且 ≠3，F4=4 自然通过，无需改动。

## 五、完成定义

1. `node --check js/data/items.js` 通过。
2. `verify_c03b` 单页 PASS（C3b-1~C3b-7 全 true）。
3. `run-all.ps1 -Budget 3500`：TOTAL=42 / PASS=42 / FAIL=0 / NONE=0 / MIXED=0。
4. `selfcheck.js` 0 FAIL。
5. 1280×800 实机截图能辨识 F3/F4 商店第 8/9 行轮换位新品。
6. 一个含 C-03b 的 commit 推送；若 Pages 不可达则如实写"线上未核验"。

## 六、取舍与已知缺口

1. **F4 池长 4 是候选不足的妥协**：合格装备全集 4 件 < 池长 5。本卡按规划端选项 C 缩为 4，代价仅是 F4 少一个展示候选、周期由 5 变 4；展示合计 11 条不变。
2. **恢复 F4 池长 5 的前提是扩充物品表**：需要新增至少 1 件「`weapon`/`armor`、`price ≥ 240`、不在 F4/F5 核心」的装备（建议 240~320 区间）。该改动会变更物品总数与价格校验和，须单开"物品扩充"卡，并同步 `selfcheck` 的 DC-01、README 物品数、C3b-4 的校验和基线。
3. **通用规则已固化**：后续任何新层/新池候选，先过两条筛子——`price ≥ 本层核心非消耗品最低价`、`不在任何更深层核心货架`；再加一条"不与同层核心重复"（否则展示合计会掉 1）。
4. **未采用方案**：A（允许同层核心重复）会让该次开张合计掉到 10；B（F4 池放消耗品）推翻 C-02「F4/F5 纯装备档」；D（改 F5 核心货架）会连带 README 的 441.9 均价口径，影响面最大。
