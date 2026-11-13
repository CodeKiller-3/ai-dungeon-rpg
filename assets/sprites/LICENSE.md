# assets/sprites 素材来源与许可

本目录是《地牢：我独自升级》的**全部**运行时像素素材，共 **207 个 PNG**（截至 v1.0.0），由两套开源素材与少量派生组成。

## 来源

| 素材 | 来源 | 原始许可 | 用途 |
|---|---|---|---|
| 角色 / 怪物 / 武器 / 道具图标 | GitHub 仓库 `fernandovmp/kni-dungeon` | MIT | 玩家与怪物帧动画、背包与商店图标 |
| 地板 / 墙体 / 装饰 / 部分怪物 | `0x72` 的 **DungeonTileset II**（经上仓库整理） | **CC0 1.0**（公有领域） | 场景贴图、细节层、装饰物 |
| `icon_armor_*.png`（5 张） | 同上（0x72 调色板内的护甲图标） | CC0 1.0 | 皮革/锁链/板甲/法袍/鳞甲五个甲系的背包图标 |
| `icon_scroll_*.png`（4 张） | 同上（卷轴 4 档） | CC0 1.0 | 强化卷轴 +1~+4 的背包图标 |

- `kni-dungeon`：<https://github.com/fernandovmp/kni-dungeon>
- `DungeonTileset II`：<https://0x72.itch.io/dungeontileset-ii>

## 处理说明

- 素材**未重绘、未重导出、未改色**，仅按游戏需要挑选文件、保持原始像素尺寸与原始文件名落盘（D-30 新增的 9 张沿用上游文件名）。
- 全部 207 张的不透明像素共用一套 **60 色**调色板（每张不超过该集合），审计脚本 `preflight/selfcheck/d21_audit.js` 可复算。
- 逐文件与 `js/core/sprites.js` 的 `NAMES` 一一对应，审计结论：207 注册 / 207 落盘 / 0 缺失 / 0 多余 / 0 空帧。

## 再分发

- **CC0 部分**：可自由使用、修改、再分发，无需署名（本项目仍在 README 与 `THIRD-PARTY-NOTICES.md` 中主动署名）。
- **MIT 部分**（kni-dungeon）：再分发时须保留其版权声明与许可文本，见 <https://github.com/fernandovmp/kni-dungeon/blob/master/LICENSE>。
- 本目录内不含任何来自商业素材包或来源不明的图片。

## 统计口径

「207」的唯一权威来源是磁盘上的 `assets/sprites/*.png` 实际数量；`js/core/sprites.js` 的 `NAMES` 必须与之相等，由 `preflight/verify_d21.html` 与 `preflight/verify_d30.html` 双重断言。
