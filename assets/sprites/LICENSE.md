# assets/sprites 素材来源与许可

本目录是《地牢：我独自升级》的**全部**运行时像素素材，共 **355 个 PNG**（截至 2026-11-18 蝙蝠/史莱姆独立帧），由两套开源素材与本项目自绘部分组成。

## 来源

| 素材 | 来源 | 原始许可 | 用途 |
|---|---|---|---|
| 角色 / 怪物 / 武器 / 道具图标 | GitHub 仓库 `fernandovmp/kni-dungeon` | MIT | 玩家与怪物帧动画、背包与商店图标 |
| 地板 / 墙体 / 装饰 / 部分怪物 | `0x72` 的 **DungeonTileset II**（经上仓库整理） | **CC0 1.0**（公有领域） | 场景贴图、细节层、装饰物 |
| `icon_armor_*.png`（5 张） | 同上（0x72 调色板内的护甲图标） | CC0 1.0 | 皮革/锁链/板甲/法袍/鳞甲五个甲系的背包图标 |
| `icon_scroll_*.png`（4 张） | 同上（卷轴 4 档） | CC0 1.0 | 强化卷轴 +1~+4 的背包图标 |
| **D-79 自绘（118 张）** | 本项目 `preflight/selfcheck` 生成脚本 + 手调像素 | **CC0 1.0**（本项目释出） | 五层主题地块、24×24 金币、氛围装饰、7 张道具重绘 |

- `kni-dungeon`：<https://github.com/fernandovmp/kni-dungeon>
- `DungeonTileset II`：<https://0x72.itch.io/dungeontileset-ii>

## 处理说明

- 除下方 **D-79 / D-80 / D-86 / 蝙蝠·史莱姆独立帧** 列出的 336 张（118 + 16 + 150 + 36 + 16）外，其余素材**未重绘、未重导出、未改色**，仅按游戏需要挑选文件、保持原始像素尺寸与原始文件名落盘（D-30 新增的 9 张沿用上游文件名）。
- **D-79 第一阶段（12 张）**：`coin.png`（6×7 → 16×16）、`floor_1..8`、`wall_left/mid/right`。
- **D-79 第二阶段（117 张 = 96 新增 + 21 覆盖，24×24 原生 1:1）**：
  - `floor_1..8`、`wall_left/mid/right`、`wall_top_left/mid/right`（14 张，F1 冷灰石厅，覆盖第一阶段的 16×16 版本）
  - `t2..t5` 各 15 张：`floor_1..8` ×8、`wall_left/mid/right` ×3、`wall_top_left/mid/right` ×3、`door` ×1（共 60 张）
  - `t1_door`（1 张）
  - `t1..t5_dc_{puddle,web,blood,rubble,chain,mold,torch}`（35 张，纯装饰层，不占格）
  - `chest`、`room_chest`、`barrel`、`torch`、`vine`、`crate`、`skull`（7 张，覆盖为 24×24）
  - 作者：本项目自绘，随项目以 **CC0 1.0** 释出；无第三方来源，无需额外署名。
  - 做法：24×24 画布按 TILE=24 **1:1 绘制**，不做任何非整数缩放；每层使用 6 个专属环境色。
- **D-80 第一阶段（16 张覆盖，24 基原生，不新增文件）**：
  - 玩家三态 12 帧：`knight_m_idle/run/hit_anim_f0..f3`，24×42 原生（落屏仍 24×42）
  - 史莱姆 4 帧：`tiny_slug_anim_f0..f3`，24×24 原生（落屏仍 24×24）
  - 作者：本项目自绘，随项目以 **CC0 1.0** 释出。
  - 做法：旧 16×28 / 16×16 帧按**当前屏幕落位尺寸**（×1.5）重画到 24 网格，表面细节逐像素重排；明暗规则同 D-79 地块（左上受光、右下压暗、1px 深轮廓），颜色全部取自既有 84 色板，未新增颜色。
- **D-80 第二阶段（150 张覆盖，24 基原生 1:1，不新增文件）**：
  - 道具/UI 图标 50 张（24×24）：26 把武器、5 件护甲、4 张卷轴、7 个药瓶、3 颗心、金币、4 个按钮箭头
  - 怪物/精英帧 100 张（14 组）：`imp / goblin / tiny_zombie / angel / skelet` 24×24、`orc_warrior / orc_shaman / wogol / necromancer / masked_orc / pumpkin_dude` 24×35、`ogre / big_demon / big_zombie` 48×54
  - 作者：本项目自绘，随项目以 **CC0 1.0** 释出。
  - 做法：新素材原生尺寸 = 旧素材屏幕落位尺寸（×1.5），因此落屏像素尺寸与 D-79 完全一致；颜色逐组取自各怪原图既有色，**84 色板未扩张**；不做任何非整数缩放（图标绘制尺寸严格等于原生 24）。
- **D-86 新增（36 张，24 基原生，三态各 4 帧）**：
  - `dragon_idle/attack/hurt_anim_f0..f3`（12 张，64×54）：F5 地牢巨龙，长颈 / 长吻 / 后掠双角 / 展开双翼 / 卷尾刺锤 / 双足三爪
  - `ogre_boss_idle/attack/hurt_anim_f0..f3`（12 张，48×54）：F2 独眼酋长，单只巨眼 / 上翘獠牙 / 尖刺肩甲 / 图腾巨斧
  - `zombie_king_idle/attack/hurt_anim_f0..f3`（12 张，48×54）：F4 僵尸王，三尖王冠 / 破烂披风 / 外露肋骨 / 权杖
  - 作者：本项目自绘，随项目以 **CC0 1.0** 释出；颜色全部取自既有 84 色板，未新增颜色。
  - 做法：战场落屏高度 = 原生高 × 2（巨龙 108px、酋长/僵尸王 108px），整数倍缩放，无插值；三只不再复用 `big_demon / ogre / big_zombie` 的杂兵帧。
- **蝙蝠 / 史莱姆独立帧（16 张新增，2026-11-18，24×24 原生 1:1）**：
  - `bat_idle_anim_f0..f3`、`bat_run_anim_f0..f3`（8 张，24×24）：暗影蝙蝠，紫褐翼膜、宽翼 + 后缘双扇贝、短耳、黄眼、骨色獠牙；不再借用 `imp_idle / imp_run`。
  - `slime_idle_anim_f0..f3`、`slime_run_anim_f0..f3`（8 张，24×24）：史莱姆，圆顶软体、双眼、四帧挤压/回弹；不再借用 `tiny_slug_anim_f0..f3`。
  - 作者：本项目自绘，随项目以 **CC0 1.0** 释出；无第三方来源，无需额外署名。
  - 做法：24×24 画布按 TILE=24 **1:1 绘制**，1px `#222222` 轮廓，左上受光 / 右下压暗；每帧 7 色，全部取自既有 84 色板，**未新增颜色**，无半透明像素。
  - 登记状态：16 张**已写入** `js/core/sprites.js` 的 `NAMES`（计数与磁盘一致）；`MONSTER_ANIM` 仍走旧帧组，换皮由后续接轨卡执行（本卡不改怪物外观）。帧名前缀与切换点见 `docs/新怪帧接轨清单-蝙蝠-史莱姆.md`。
- 全部 355 张的不透明像素共用一套 **84 色**调色板（60 基础色 + F2~F5 各 6 个主题专属色），审计脚本 `preflight/selfcheck/d21_audit.js` 可复算。
- 与 `js/core/sprites.js` 的 `NAMES` 对应关系：**355 注册 / 355 落盘 / 0 缺失 / 0 多余 / 0 空帧**。

## 再分发

- **CC0 部分**：可自由使用、修改、再分发，无需署名（本项目仍在 README 与 `THIRD-PARTY-NOTICES.md` 中主动署名）。
- **MIT 部分**（kni-dungeon）：再分发时须保留其版权声明与许可文本，见 <https://github.com/fernandovmp/kni-dungeon/blob/master/LICENSE>。
- 本目录内不含任何来自商业素材包或来源不明的图片。

## 统计口径

「355」的唯一权威来源是磁盘上的 `assets/sprites/*.png` 实际数量；`js/core/sprites.js` 的 `NAMES` 必须与之相等（当前 355），由 `preflight/verify_d21.html` 与 `preflight/verify_d30.html` 双重断言。调色板的唯一权威来源是 `preflight/selfcheck/d21-audit.json` 的 `paletteSize`。
