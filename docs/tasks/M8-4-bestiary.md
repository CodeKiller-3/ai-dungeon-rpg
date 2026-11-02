# M8-4 任务卡：图鉴收集（怪物/物品图鉴，M 面板分页）

> 阶段：M8 内容深度（PLAN.md §14.3 / §15.4 M8-4）
> 目标：击杀怪物/获得物品自动登记图鉴；M 面板三页签（任务/怪物/物品）可翻页浏览
> 打磨上限：2-4 遍（判据是 PASS，不是遍数）

## 一、背景

- M 键现开 `Game.Modal.open('quests')`（独立 scene 'quests'），quests kind 数据来自 `Game.Systems.Quest.getActive()`（modal.js 白名单：inventory/shop/quests/settings/gameover）。
- 击杀已有登记点：`battle.settleWin` 胜利结算（monsterId 可得）；物品获得点：`battle.settleWin` 掉落、`shop.js` 购买。
- 存档：`js/systems/save.js` 顶层字段读写（Player 等），旧档兼容已有先例（M8-1 mp 补默认）。

## 二、契约（纯新增模块 + quests kind 分页改造）

### 2.1 图鉴登记（新增 `js/systems/bestiary.js`）

```
Game.Systems.Bestiary = {
  record: function (type, id) -> void,   // type: 'monster' | 'item'；计数 +1
  getMonsterCount: function (id) -> number,
  getItemCount: function (id) -> number,
  data: { monsters: {id: count}, items: {id: count} }   // 运行时状态（顶层引用，供存档/验证读取）
};
```

- **登记点**：`battle.settleWin` 胜利时 `record('monster', m.id)`；掉落入库与 `shop` 购买成功时 `record('item', id)`（掉落变体 id 原样登记）；
- 登记状态并入存档：save.js 存档新增顶层 `bestiary` 字段（存 `{monsters:{}, items:{}}`），load 时缺失补默认、存在则合并（计数取较大者，防旧档回退覆盖）。

### 2.2 M 面板分页（modal.js quests kind 改造）

- `open('quests')` 内部维护 `page`（0=任务 / 1=怪物 / 2=物品），默认 0；
- **Tab 或 ←/→ 切页**（←/→ 若与列表选择冲突，用 Tab 切页 + ↑/↓ 列表选择，二选一以现有选择逻辑为准）；
- 三页数据：
  - 任务页：现有 `Quest.getActive()`（行为不变）；
  - 怪物页：`Game.Data.MONSTERS` 全量——**已击杀**（count>0）：显示名称 + 属性（HP/ATK/DEF）+ 击杀数；**未击杀**：显示名称 + `???`（隐藏数值）；
  - 物品页：`Game.Data.ITEMS` 全量——**已获得**（count>0）：名称 + 类型/效果 + 价格；**未获得**：名称 + `???`；
- 页签标题绘制在面板顶部（「任务 / 怪物 / 物品」，当前页高亮）；
- 空状态（怪物页全未击杀仍显示条目名+???，不是空白；物品页同理）。

### 2.3 约束

- 图鉴**不新增自由描述文案**（防幻觉）：只展示现有数据字段（名称/HP/ATK/DEF/价格/effect）与 ??? 占位；
- quests kind 现有任务页行为不变（回归保障）；M 键绑定不变；
- 变体物品（`_rare/_epic`）计入物品页（未获得显示 ???，获得后显示其独立属性）。

## 三、文件范围

| 文件 | 动作 |
|---|---|
| `js/systems/bestiary.js` | **新增**：登记模块 |
| `js/systems/battle.js` | 修改：settleWin 登记怪物击杀 + 掉落物品 |
| `js/systems/shop.js` | 修改：购买成功登记物品 |
| `js/systems/save.js` | 修改：存档 bestiary 字段读写与合并 |
| `js/systems/modal.js` | 修改：quests kind 分页（page 状态、Tab/←→ 切页、三页绘制、??? 占位） |
| `index.html` | 修改：systems 组接入 bestiary.js |
| `README.md` | 修改：功能列表补充图鉴收集 |
| `preflight/verify_m8_4.html` | **新增**：R-01 模板验证页 |

## 四、硬性约束

- 原生 JS + Canvas 零构建；file:// 双击 index.html 可玩；不引入 npm/构建工具/付费资源。
- 图鉴只展示既有数据字段 + ???，**不新增描述文案**。
- quests kind 任务页行为不变；M 键与 scene 流转不变。
- 存档 bestiary 缺失补默认、存在合并取较大计数，不破坏旧档。
- 登记点只加在既有胜利/获得路径内，不改结算语义。

## 五、完成标准

1. 列出改动文件清单（文件 + 行数概览）。
2. 用下方验证命令跑 `preflight/verify_m8_4.html`，输出必须出现 `bestiaryLoaded:true`、`bestiaryApi:true`、`bestiaryOk:true`。
3. 说明剩余风险点。
4. 实现不了的直接说卡点与尝试，不绕过不改方案。

## 六、验证命令（Start-Process 方案）

```
$env:PATH="C:\Windows\System32;C:\Windows;$env:PATH"
$edge="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$od="$env:TEMP\m84.out.txt"; $ed="$env:TEMP\m84.err.txt"; $pd="$env:TEMP\edgem84"+(Get-Random)
Start-Process -FilePath $edge -ArgumentList "--headless=new","--disable-gpu","--no-first-run","--user-data-dir=$pd","--virtual-time-budget=3500","--dump-dom","file:///D:/桌面/工作/人工智能大作业/preflight/verify_m8_4.html" -Wait -PassThru -RedirectStandardOutput $od -RedirectStandardError $ed | Out-Null
Get-Content $od -Raw
```

验证页要求（加载顺序与主游戏一致）：
- 模块加载与接口齐备（Bestiary.record/getMonsterCount/getItemCount/data）；
- **登记**：record('monster','slime') 后 count===1，再 record 变 2；record('item','sword_bone') 后 count===1；
- **battle 登记**：构造一次胜利后 Bestiary.data.monsters 含对应 id 且计数正确；掉落物品登记存在；
- **shop 登记**：购买成功后 item count 增加（购买失败不登记）；
- **存档**：save 后 bestiary 字段写入；load 恢复计数；旧档无 bestiary 时补默认且不抛错；合并规则（存较大计数）正确；
- **分页**：open('quests') 后 page 默认 0；切页到 1/2 正常；未击杀怪物条目含 `???` 且不含 HP 数值、已击杀条目含数值与击杀数；物品页同理；
- 任务页数据与改造前一致（getActive 返回结构不变）；
- 翻页/关闭/重开不抛错；
- title/body 各出现一次 `PASS {...}`。

## 七、回归要求

- 主游戏 `index.html` headless 冒烟：无 `Uncaught/TypeError/ReferenceError/SyntaxError`。
- S3-1/2/3/4 + M9-1/2/3/4/5 + M8-1/2/3 验证页复跑 PASS。
