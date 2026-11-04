# P1-2 UI 像素化（HUD 心形血条 + 弹窗像素边框 + 物品图标）

> 阶段：P1 视觉重做 · 第 2 卡
> 状态：待 Trae 实现
> 素材：P1-1 已备 ui_heart/flask/coin/button，本卡新增 11 张（weapon×8 + flask_big×3）已由豆包裁入 `assets/sprites/`

## 一、背景与目标

P1-1 场景贴图化已完成并推送（`9acc4a3`）。当前 HUD 为纯色短条 + 文字（hud.js），弹窗为单色面板 + 文字列表（modal.js）。本卡把**界面层升级为像素风**：HP 改像素心形、金币/道具带图标、弹窗面板像素化描边。**不改任何战斗/地图/输入/数值逻辑，纯绘制层改造。**

## 二、素材清单（已就位，勿重裁）

| 组 | 文件 | 用途 |
|---|---|---|
| 心形（P1-1 已有） | `ui_heart_full/empty/half.png`（13×12） | HUD HP 图标序列 |
| 药水（P1-1 已有） | `flask_red/blue/green/yellow.png`（16×16） | MP 图标 + 小药水道具图标 |
| 大药水（本卡新增） | `flask_big_red/green/blue.png`（16×16） | 大药水道具图标 |
| 金币（P1-1 已有） | `coin.png`（6×7） | 金币图标 |
| 武器（本卡新增） | `weapon_rusty_sword/regular_sword/golden_sword/red_gem_sword/lavish_sword/axe/bow/spear.png` | 武器道具图标 |
| 按钮（P1-1 已有，本卡可不接） | `button_red/blue_up/down.png` | 9-patch 按钮（本卡不做，留 P1-3） |

## 三、实现要点

1. **HUD（js/systems/hud.js）**：
   - **HP 条改心形序列**：新增 `heartIcons(hp, hpMax)` 辅助——每 `HEART_HP=20` 点一颗心（maxHp 100 → 5 颗；190 → 10 颗），整颗=`ui_heart_full`、余量 ≥10 点=`ui_heart_half`、其余=`ui_heart_empty`；绘制尺寸建议 15×14（13×12 放大），心间距 2px，行高 y=6 起垂直居中。心形序列后仍显示小字 `80/100`（11px 灰白）。**窄窗口降级**：心形缩至 11×10 且省略数字（沿用现有"放不下就跳过"策略，不横向溢出）。
   - **MP 条**：短条前加 `flask_blue` 图标（14×14，y=5 垂直居中）；条本身保持。
   - **金币**：文字前加 `coin` 图标（9×10，y=5 垂直居中）。
   - 层/击杀/Lv 字段保持文字（不画图标，克制）。
   - 心形/图标绘制前 `Sprites.get(name)` 判空，缺失回退现有短条/纯文字（不抛错）。
   - `Game.hud.last` 快照字段不变（验证页兼容）。

2. **弹窗面板（js/systems/modal.js）**：
   - **像素化边框**：现有单层 `strokeRect` 改为双层——外 `rgba(0,0,0,0.9)` 1px + 内 `rgba(255,255,255,0.35)` 1px（面板内侧 1px 处）；标题行下方加 1px `rgba(255,207,110,0.35)` 分隔线（标题 y+34 处）。
   - **选中行**：现有半透明金底保持，行左侧加 2px 竖条 `#ffcf6e`（px+6 处）。
   - 底部操作提示区：上方加 1px `rgba(255,255,255,0.12)` 分隔线。
   - 按钮保持文字式（fillRect + 双层描边），不做 9-patch 贴图。

3. **物品图标（js/systems/modal.js 列表行 + 商店行）**：
   - 新增 `itemIcon(id)` 映射（在 modal.js 内私有函数）：potion_small→`flask_red`、potion_large→`flask_big_red`、sword_bone→`weapon_rusty_sword`、sword_dragon→`weapon_red_gem_sword`；rare/epic 变体（含后缀 `_rare/_epic` 的 id 或 `ITEMS` 定义里的变体）按 base 映射增强：sword_*_rare→`weapon_golden_sword`、sword_*_epic→`weapon_lavish_sword`；armor_* 无对应图标→不画；未知→不画。**映射表以 `Game.Data.ITEMS` 实际 id 为准**（先读 js/data/items.js 核对 id 命名再写映射，读不到就按上述规则保守实现）。
   - 列表行（inventory/shop）：行文字左移 22px，行左侧 16×16 画图标（y 居中对齐行高）；无图标则文字原位（回退）。
   - 图鉴物品页（quests 的 page 2）行同样处理（可选，若行结构一致则一并接入）。

4. **不改动**：items.js 数值/词缀、商店价格、交互热区（rect 计算不变，仅绘制层）、HUD update 契约。

## 四、硬性约束

- 原生 JS + Canvas，零构建，file:// 可玩；不引入新库。
- `Sprites.get` / `Game.hud.last` / `Game.hud.update(stats)` 签名不变。
- 素材不重裁不改名；新增素材仅本卡 11 张（已就位）。
- 窄窗口（320px）不得横向溢出；弹窗热区（点击/键盘选择）行为不变。

## 五、完成标准

1. 列出改动文件清单。
2. 新建 `preflight/verify_p1_2.html`（R-01 模板，复用 P1-1 的包装 ctx.drawImage 记录法避免 file:// 污染），断言：
   - t2_hearts：`Game.hud.update({hp:50,hpMax:100,...})` 后 draw，drawImage 记录含 `ui_heart_full`（2 颗整 + 余 10 → half）与 `ui_heart_half`，总数 = ceil(100/20)=5 且含 `ui_heart_empty`
   - t3_goldIcon：draw 记录含 `coin`
   - t4_mpIcon：draw 记录含 `flask_blue`
   - t5_itemIcon：构造含 potion_small/sword_bone 的 inventory 数据打开弹窗，draw 记录含 `flask_red`/`weapon_rusty_sword`
   - t6_panel：弹窗 draw 时 strokeRect 调用 ≥2 次（双层边框）且含标题分隔线（fillRect 颜色含金色系）
   - t7_narrow：模拟窄窗（cssW≈320）draw 不抛错且心形绘制尺寸 ≤ 全宽（无溢出：所有 drawImage x+w ≤ W）
   - t8_fallback：`Sprites._pool` 清空或素材缺失时 draw 不抛错、回退短条/文字
   - t9_idem：同参两次 draw 绘制序列一致（无随机闪烁）
   - 输出 `PASS {"uiLoaded":true,"uiApi":true,"uiOk":true}` + 子断言
3. index.html 冒烟无 `Uncaught/TypeError/ReferenceError`；已有 preflight 页全量回归全 PASS（或说明受影响断言原因）。
4. 说明剩余风险点。

## 六、验证命令

项目根新建 `preflight/verify_p1_2.html`（R-01：加载顺序与 index.html 一致、IIFE try/catch、title+body 各输出一次 PASS JSON）。Edge file:// 打开看 Console。

## 七、风险点（已知）

- 心形数量随等级增长（L10 maxHp 190 → 10 颗），可能挤占窄屏——以"心形缩尺寸 + 省略数字"两级降级保底，不做翻页。
- itemIcon 映射依赖 items.js 实际 id；如变体 id 命名与预估不符，以读到的为准并最小化映射（宁可少映射不映射错）。
- 双击/键盘选中行的热区以 rect 为准，绘制偏移不得改变 rect 计算。
