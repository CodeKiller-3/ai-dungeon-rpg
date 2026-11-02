# M8-3 任务卡：装备词缀（普通/优秀/稀有 三档随机属性）

> 阶段：M8 内容深度（PLAN.md §14.3 / §15.4 M8-3）
> 目标：装备分三档品质（普通/优秀/稀有），掉落与商店按概率出现多档，属性公式化可复算
> 打磨上限：3-5 遍（判据是 PASS，不是遍数）

## 一、背景

现有装备系统（`js/data/items.js`）：3 件装备 `sword_bone`(atk+3) / `sword_dragon`(atk+8) / `armor_leather`(def+3)，无品质概念。背包结构 `inventory = { itemId: count }`（无实例），装备槽 `equipment = { weapon: id, armor: id }`，`inventory.recalcEquip` 从 `ITEMS[id].effect` 重算 `p.atk/p.def`。

## 二、契约（最小侵入：变体 id 方案，不动 inventory schema）

### 2.1 品质变体（items.js）

每件装备保留原 id 为**普通档**，新增两个变体 id：

```
sword_bone     → 普通白骨剑   effect {atk:3}   price 60
sword_bone_rare → 优秀白骨剑  effect {atk:round(3×1.5)=5}   price 120
sword_bone_epic  → 稀有白骨剑  effect {atk:round(3×2)=6, maxHp:10}  price 240
```

规则（全部公式化）：
- 变体 id 命名：`<原id>_rare` / `<原id>_epic`；
- 优秀档：`effect 各项 = round(普通档 × 1.5)`；稀有档：`round(普通档 × 2)` + 额外 `maxHp: 10`（稀有专属词缀）；
- 变体 name 加前缀「优秀」「稀有」；`price = 普通档 × 2 / ×4`，`sell = price / 2`；
- 3 件装备 × 3 档 = 9 个物品条目（3 原有 + 6 新增），**不删改原 3 条**。

### 2.2 掉落分级（monsters.js + battle.js）

- 现有 `drops: [{itemId, rate}]` 保持兼容；为装备类掉落新增可选字段 `tiers`：
  ```
  drops: [{ itemId: 'sword_bone', rate: 0.15, tiers: [
    { itemId: 'sword_bone', w: 60 }, { itemId: 'sword_bone_rare', w: 30 }, { itemId: 'sword_bone_epic', w: 10 }
  ]}]
  ```
- 语义：先按 `rate` 判定是否掉落；若命中且有 `tiers`，按权重 `w` 随机选中一个变体入库（无 `tiers` 时行为与现在完全一致）；
- `battle.settleWin` 支持 `tiers` 分支（权重随机），普通怪掉落表保持不变；
- 掉落概率建议：普通 60% / 优秀 30% / 稀有 10%（skeleton 掉剑、dragon 掉龙牙剑处启用）。

### 2.3 商店分级（shop.js）

- 商店货架（现 `SHOP_SHELVES` 固定条目）中装备条目改为三档变体并排（普通/优秀/稀有各一，按价格售卖）；
- 玩家可买任意档；购买入库与现有逻辑一致（按变体 id 计数）。

### 2.4 装备与重算（inventory.js）

- `equip`/`recalcEquip` 逻辑不变（按 id 读 `ITEMS[id].effect`）；变体 id 天然支持；
- 稀有档额外 `maxHp` 词缀：`recalcEquip` 后 `p.maxHp = 基础 + 各装备 maxHp 之和`（基础 100），且 `p.hp = min(p.hp, p.maxHp)` 不越界；卸下时同理回落（hp 保持现值不超新上限）。

## 三、文件范围

| 文件 | 动作 |
|---|---|
| `js/data/items.js` | 修改：新增 6 个变体条目（公式化 effect/price/sell） |
| `js/data/monsters.js` | 修改：skeleton/dragon 的装备掉落加 `tiers` |
| `js/systems/battle.js` | 修改：settleWin 支持 tiers 权重掉落（无 tiers 行为不变） |
| `js/systems/shop.js` | 修改：货架三档变体 |
| `js/systems/inventory.js` | 修改：recalcEquip 支持 maxHp 词缀与上下限钳制 |
| `README.md` | 修改：功能列表补充装备三档品质 |
| `preflight/verify_m8_3.html` | **新增**：R-01 模板验证页 |

## 四、硬性约束

- 原生 JS + Canvas 零构建；file:// 双击 index.html 可玩；不引入 npm/构建工具/付费资源。
- **不改 inventory schema**（{id:count} 与 equipment {weapon,armor} 结构不变），纯新增变体条目与可选 tiers 字段。
- 变体 effect/price 全部公式化（×1.5/×2/+10），验证页按公式复算断言。
- 无 `tiers` 的掉落行为与现在完全一致（回归保障）。
- 稀有 maxHp 词缀上下限钳制：hp 不超 maxHp、卸装回落不溢出。

## 五、完成标准

1. 列出改动文件清单（文件 + 行数概览）。
2. 用下方验证命令跑 `preflight/verify_m8_3.html`，输出必须出现 `affixLoaded:true`、`affixApi:true`、`affixOk:true`。
3. 说明剩余风险点。
4. 实现不了的直接说卡点与尝试，不绕过不改方案。

## 六、验证命令（Start-Process 方案）

```
$env:PATH="C:\Windows\System32;C:\Windows;$env:PATH"
$edge="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$od="$env:TEMP\m83.out.txt"; $ed="$env:TEMP\m83.err.txt"; $pd="$env:TEMP\edgem83"+(Get-Random)
Start-Process -FilePath $edge -ArgumentList "--headless=new","--disable-gpu","--no-first-run","--user-data-dir=$pd","--virtual-time-budget=3500","--dump-dom","file:///D:/桌面/工作/人工智能大作业/preflight/verify_m8_3.html" -Wait -PassThru -RedirectStandardOutput $od -RedirectStandardError $ed | Out-Null
Get-Content $od -Raw
```

验证页要求（加载顺序与主游戏一致）：
- 模块加载与接口齐备（ITEMS 含 9 个条目：3 原 + 6 变体；变体 id 命名正确）；
- **公式**：sword_bone_rare.atk===5、sword_bone_epic.atk===6 且 maxHp===10、armor_leather_rare.def===round(3×1.5)===5（round(4.5)=5 用 Math.round）、price 翻倍规则；
- **tiers 掉落**：settleWin 时无 tiers 掉落与旧逻辑一致（itemId 直入）；有 tiers 时按权重出变体（mock 随机断言 0-59% 出普通、60-89% 出优秀、90-99% 出稀有，边界 59/89 断言）；
- **商店**：货架含三档变体条目且价格正确；
- **recalcEquip**：装备 sword_bone_epic 后 atk 含 6、maxHp===110；卸下后回落 100、hp 钳制不越界；
- 背包/商店旧功能（use 药水、买卖）不受影响；
- 重复操作不抛错；
- title/body 各出现一次 `PASS {...}`。

## 七、回归要求

- 主游戏 `index.html` headless 冒烟：无 `Uncaught/TypeError/ReferenceError/SyntaxError`。
- S3-1/2/3/4 + M9-1/2/3/4/5 + M8-1/2 验证页复跑 PASS。
