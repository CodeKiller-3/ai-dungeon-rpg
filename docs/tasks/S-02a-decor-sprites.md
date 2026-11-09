# S-02a 装饰物素材补齐（barrel / torch / vine）

- 卡号：S-02a
- 前置：`规划-对标补齐.md` v2（作品导向）已确认
- 目标：消除静态自检唯一 FAIL `AS-03 装饰物 id 未注册素材名（barrel, torch, vine）`，让地图上这三类装饰物真正用贴图绘制，而不是每次启动 404 后走程序化兜底。

## 改动范围（只许改这两处）

1. `assets/sprites/barrel.png`、`torch.png`、`vine.png` 新增，规格：16×16、32bpp ARGB、透明底、PNG。
2. `js/core/sprites.js` 的 `NAMES` 恢复 `barrel` / `torch` / `vine` 三项（`grass` / `puddle` / `bones` / `moss` 仍不恢复，它们没有使用者）。

## 不许动

- 不许改 `map.js` 的 `DECOR` 列表（装饰物 id 是玩法数据，不是素材问题）。
- 不许改渲染层的兜底逻辑（`_drawDetail` / `_drawDecor` 的 `get()` 失败回退路径保留）。
- 不许改自检规则等级（不允许把 AS-03 降为 WARN 来"通过"）。

## 验收断言（`preflight/verify_s02a.html`）

| 断言 | 判据 |
|---|---|
| t1_decorIds | `DECOR` 中 `barrel` / `torch` / `vine` 三个 id 存在 |
| t2_loaded | `Sprites.load('../assets/sprites/')` 后 `isReady()===true`（≤3s） |
| t3_sprite | `Sprites.get('barrel'/'torch'/'vine')` 均非 null，`naturalWidth===16 && naturalHeight===16` |
| t4_noFallback | 三者齐全即视为兜底路径不再被触发（用于说明 404 消失） |
| t5_register | 注册总数由 194 → 197 |

## 完成定义

- `node preflight/selfcheck/selfcheck.js`：33 项 **0 FAIL**（AS-03 转 PASS）
- `run-all.ps1`：36/36 PASS（新增 verify_s02a）
- `index.html` 冒烟 `{"errors":[]}`
- 一张 headless 截图（第 1 层实机，含装饰物）
- 一个 commit，message：`S-02a 补齐 barrel/torch/vine 装饰素材`

## 风险

| 风险 | 对策 |
|---|---|
| 自绘风格与 0x72 CC0 精灵不一致 | 16×16 小尺寸 + 限定调色板（暗棕/金属/火焰/藤绿），远看只区分轮廓 |
| 贴图放大后糊 | 渲染层按整数倍缩放（既有逻辑），不额外缩放 |
| 装饰物位置与墙体重叠 | 沿用既有 `DECOR` 放置规则，不改 |

## 七、落地口径

- 三张 16×16 自绘 PNG 已入库，实测字节数：`barrel.png` 195 B、`torch.png` 236 B、`vine.png` 220 B。
- `js/core/sprites.js` 的 `NAMES` 恢复注册 `barrel` / `torch` / `vine` 后，静态自检 AS-01 / AS-03 转 PASS；当前注册 198 / 磁盘 198，全部有对应 PNG。
- `grass` / `puddle` / `bones` / `moss` 仍不注册（无使用方），渲染层继续走 `_drawDetail` / `_drawDecor` 程序化兜底。
