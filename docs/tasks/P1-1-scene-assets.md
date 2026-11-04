# P1-1 场景素材管线落地（地板变体 + 墙体体系 + 装饰贴图 + 骷髅动画）

> 阶段：P1 视觉重做 · 第 1 卡
> 状态：待 Trae 实现
> 素材：52 张已由豆包从 0x72 DungeonTileset II v1.7（CC0）裁剪完毕，位于 `assets/sprites/`

## 一、背景与目标

当前游戏场景为纯色块绘制（地板单色、墙体单色、装饰程序化色块），这是"简陋感"的主要来源。
0x72 DungeonTileset II v1.7（CC0）完整素材已落地 `assets/sprites/`（地板 8 变体、墙体体系 24 张、装饰 5 张、骷髅怪动画 8 帧、UI 图标等）。
本任务把**场景渲染从色块升级为像素贴图**，并让骷髅士兵怪使用真实动画帧。**不改任何战斗/地图/移动逻辑，纯渲染层替换。**

## 二、素材清单（已就位，勿重新裁剪）

`assets/sprites/` 下新增（现有 kni 6 张保留不动）：

| 组 | 文件 | 用途 |
|---|---|---|
| 地板变体 | `floor_1.png` ~ `floor_8.png` | 地面 tile 随机变体（8 选 1，可复现伪随机） |
| 楼梯 | `floor_stairs.png`、`floor_ladder.png` | 楼梯/梯子（如当前有 stair 格则替换） |
| 墙体体系 | `wall_left/mid/right.png`、`wall_top_left/mid/right.png`、`wall_edge_*.png`(6)、`wall_outer_*.png`(6) | 墙壁按相邻关系选图（至少左/中/右+顶边，edge/outer 可选） |
| 装饰 | `chest.png`(宝箱)、`crate.png`(木箱)、`skull.png`(头骨)、`wall_goo.png`(苔藓黏液) | 替换对应程序化色块；`barrel/torch/vine/grass/puddle` 无真贴图，**保留程序化兜底** |
| 骷髅动画 | `skelet_idle_anim_f0~f3.png`、`skelet_run_anim_f0~f3.png` | 骷髅士兵怪 idle/run 各 4 帧动画 |
| UI（本卡可不接） | `ui_heart_*.png`、`flask_*.png`、`coin.png`、`button_*.png` | P1-2 UI 像素化使用，本卡不做 |

## 三、实现要点

1. **sprites.js 扩展**（`js/core/sprites.js`）：
   - NAMES 数组追加全部新素材名（52 个，勿删现有 14 个）。
   - 新增帧序列接口（保持 get(name) 兼容）：`Game.Core.Sprites.getFrame(name, idx)` 或等价实现——对 `skelet_idle_anim_f0~f3` 这类命名，按 `{base}_anim_f{idx}` 或显式帧数组映射取帧；缺帧返回 null，渲染层兜底。
   - 加载机制不变：`img.src = 'assets/sprites/' + name + '.png'`，onerror 不入库，渲染层程序化兜底（现有逻辑）。

2. **render.js 场景绘制**（`js/core/render.js`，drawMap 相关函数）：
   - **地板**：找到当前地板 fillRect 处，改为 `Sprites.get('floor_1'~'floor_8')` 按格伪随机选取 drawImage 整格（16x16 贴图，目标格 TILE×TILE 拉伸绘制）；无贴图时回退现有色块。伪随机需可复现（如 `(x*7 + y*13 + floor*3) % 8` 或格坐标 hash），不依赖 Math.random 以免每帧闪烁——同一格同一 floor 每次绘制选同一变体。
   - **墙体**：当前墙 fillRect 处改为 wall 贴图。至少按"墙与相邻墙/地"选 `wall_mid/wall_left/wall_right/wall_top_*`；edge/outer 系列作为增强（能接则接，接不全不报错）。迷宫墙顶边与墙身分两行绘制的，可先统一用 wall_mid 平铺+顶行 wall_top_*，视觉即显著改善。
   - **装饰**：drawDecor/drawDetail 处（chest/crate/skull/wall_goo），有贴图则 drawImage 替换色块；`barrel/torch/vine/grass/puddle` 继续走程序化兜底。
   - **骷髅怪**：`drawMonster` 中怪物 id === 'skeleton' 时，用 `skelet_run_anim_f{idx}`（追击中）或 `skelet_idle_anim_f{idx}`（未追击），idx 按游戏 tick/帧计数循环（f0→f1→f2→f3→f0，约 4 帧/秒即可，可用现有 rAF 计数）；无贴图回退现有色块。其他怪物（slime/bat/dragon）不动。
   - **所有 drawImage 目标尺寸**：贴图 16x16 拉至 TILE 格（TILE-1 或 -2 防接缝）；skelet 帧同 TILE 尺寸。

3. **不改动**：map.js 地图生成、fov、战斗、移动、HUD 逻辑。`Game.Core.Sprites.isReady()` 为 false 或素材缺失时全量回退现状（渲染层兜底已存在，保持）。

## 四、硬性约束

- 原生 JS + Canvas，零构建，`file://` 双击 index.html 可玩；不引入 npm/构建工具/新库。
- 不改既有契约：`Sprites.get(name)` 签名不变、渲染函数签名不变、地图数据/怪物数据不改。
- 素材文件已就位，**不得改名、不得重新裁剪、不得删现有 kni 精灵**。
- 纯新增/替换渲染层，战斗数值、掉落、AI 行为一律不动。

## 五、完成标准

1. 列出改动文件清单。
2. 用下方验证命令跑验证页，输出必须出现 `PASS {"sceneLoaded":true,"sceneApi":true,"sceneOk":true}` 且 6 个子断言全 true：
   - t2_floor：floor_1~8 均入库（Sprites.get 非 null）
   - t3_wall：wall_mid/wall_left/wall_right/wall_top_mid 均入库
   - t4_decor：chest/crate/skull/wall_goo 均入库
   - t5_skelet：skelet_idle/run 各 4 帧经 getFrame 可取得且非 null
   - t6_draw：drawMap 在空地图（如 5x5 全地板）执行不抛异常，且 floor 变体选择在两次绘制同一格时一致（可复现性）
   - t7_fallback：模拟素材缺失（临时用不存在名字 get）返回 null 且绘制不抛异常
   - t8_idem：连续两次 drawMap 输出一致（无随机闪烁）
3. 全量回归：index.html 冒烟无 `Uncaught/TypeError/ReferenceError`；已有 preflight 页（S3-1~4、M9-1~5、M8-1~6、verify_p1p2）全 PASS 或仅渲染断言受贴图影响需说明原因。
4. 说明剩余风险点。

## 六、验证命令（Trae 本地跑）

在项目根目录新建 `preflight/verify_p1_1.html`（R-01 模板：加载顺序与 index.html 一致、IIFE try/catch、title+body 各一次输出 PASS JSON），断言见第五节。跑法：Edge 打开 file:// 验证页，Console 看 PASS JSON。

## 七、风险点（已知）

- 墙体系 edge/outer 若当前地图结构是"整块墙"非逐格墙，选图逻辑可能不适用——以"至少 wall_mid 平铺 + 顶行 wall_top_*"为保底，edge 增强可不做，不能因此阻塞。
- 地板变体若导致视觉太花，可减少变体数（如 floor_1/2/4/6 四选一），阈值可调。
- skelet 帧动画若与现有 motion 插值冲突（绘制位置插值中换帧），以"位置插值优先、帧按时序切"为准，不阻塞。
