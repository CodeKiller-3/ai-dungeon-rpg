# D-12 流畅度与跟手度优化（先量化后动手）

基线：`82611fd`（D-11 修复后，回归 52/52 PASS）。真人反馈：「运行没问题，但还是不够流畅、不够跟手。」

## 一、定位

两个独立问题，各自有量化证据：

1. **不够流畅**：`render.js#drawMap` 每帧把整层地板/墙/装饰逐格重画一遍，叠加 `lighting.js` 每帧重建全屏径向渐变暗角。
   全探索 21×15 层实测每帧 **859 次 `drawImage` + 865 次 `fillRect` + 866 次 `Sprites.get`**，帧 P50 **11.7ms**（其中 JS 侧仅 1.5ms，**10.2ms 花在 Canvas 光栅化 flush**）。
   逐格地图占 57%、光影 43%（暗角单独 28%）。
2. **不够跟手**：`main.js#_updateExplore` 用单一 `MOVE_INTERVAL=120ms` 硬节流，**落在窗口内的按键整步丢弃**。
   实测短按 200 次 **丢 160 次（80%）**，长按输入延迟 P50 65ms / P95 122ms / 最大 133ms——「按了没反应」由此而来。

## 二、静态排查（逐项判定）

| 候选 | 判定 | 依据 |
|---|---|---|
| 每帧全量重绘地图 | **是**（流畅度主因） | 每帧 859 `drawImage`；摘掉 `drawMap` 后帧 P50 11.7→0.1ms |
| 每帧全屏暗角渐变 | **是**（次要） | 跳过 `CanvasGradient` 全屏填充后 11.7→8.4ms（占 28%） |
| 移动 120ms 硬节流丢输入 | **是**（跟手度主因） | 短按丢弃率 80%，长按 P95 122ms |
| 每帧 `JSON` 序列化 / localStorage 写 | 否 | `save.js` 只在换层/战斗结束/通关事件点调用；压测 1200 帧内 0 次序列化 |
| 每帧新建 canvas / Image | 否 | 全库仅 `lighting.js` 一处 `createElement('canvas')`，为 init 预建；本次改为尺寸变化才重建 |
| 重复 `Sprites.get` 查表 | 是（附属） | 每帧 866 次，全部来自逐格地形绘制；随离线缓存一并消除 |
| 主线程长任务 >50ms | 否 | 改前改后均 0 次（>16.7ms：staticBig 2/1200、move 5/1200 → 均 0） |
| `update` 逻辑耗时 | 否 | P50 0.0ms、P95 0.1ms、max 0.2ms，无优化空间 |

## 三、压测取证（同一脚本、同一场景、改前改后各跑一次）

压测页 `preflight/perf_d12.html`（不进 `run-all`，不在 `js/` 内打桩），Node CDP 驱动器 `preflight/perf_d12_run.js`：
真实时钟下驱动（`--virtual-time-budget` 会接管 `performance.now`，测不出真实 CPU 耗时，故不用它）。
每帧末尾 `getImageData(0,0,1,1)` 强制 flush，把 Canvas2D 延迟光栅化成本计入帧耗时。
固定种子 `mulberry32(20261210)`、冻结动画帧、清空敌人与巡逻怪、F5 全层点亮（851 格）。

证据文件：`preflight/selfcheck/d12-before.json`（旧代码）、`d12-after.json`（新代码）、
`d12-old-fp.json`（`git stash` 跑旧代码取指纹）、`d12-before2.json`（重复跑，验证数字稳定）。

### 改前 / 改后对比（F5 全探索 1200 帧）

| 指标 | 改前 | 改后 | 变化 |
|---|---|---|---|
| 帧耗时 P50 | 11.7 ms | **1.8 ms** | −85% |
| 帧耗时 P95 | 13.6 ms | **2.7 ms** | −80% |
| 帧耗时 max | 17.4 ms | 9.6 ms | −45% |
| 其中 JS draw P50 | 1.5 ms | 0.4 ms | −73% |
| 其中光栅 flush P50 | 10.2 ms | 1.4 ms | −86% |
| 每帧 `drawImage` | 859 | **8** | −99% |
| 每帧 `fillRect` | 865 | 31 | −96% |
| 每帧 `Sprites.get` | 866 | **10** | −99% |
| >16.7ms 帧数 | 2 / 1200 | 0 / 1200 | — |
| >50ms 长任务 | 0 | 0 | — |

其它场景：

| 场景 | 改前帧 P50 | 改后帧 P50 | 改前 drawImage | 改后 drawImage |
|---|---|---|---|---|
| 初始视野（未全探索）600 帧 | 6.7 ms | 1.7 ms | 109 | 7 |
| 移动中 1200 帧 | 11.8 ms | 1.8 ms（P95 8.2） | 859 | 8 |
| 战斗 600 帧 | 0.5 ms | 0.7 ms（噪声内，未改战斗渲染） | 4 | 4 |
| 摘光影 300 帧 | 6.7 ms | 0.8 ms | 858 | 6 |
| 摘暗角 300 帧 | 8.4 ms | 1.8 ms | 859 | 8 |
| 摘整张地图 300 帧 | 0.1 ms | 0.1 ms | 3 | 3 |

### 输入延迟（keydown `timeStamp` → 移动真正生效那一帧的 `performance.now()`）

| 指标 | 改前 | 改后 |
|---|---|---|
| 短按丢弃次数 | **160 / 200** | **0 / 200** |
| 长按丢弃次数 | 0 / 200 | 0 / 200 |
| 延迟 P50（全部 240→400 样本） | 55.0 ms | **8.03 ms** |
| 延迟 P95 | 121.95 ms | **15.79 ms** |
| 延迟 max | 132.97 ms | **16.60 ms** |

改后延迟 ≈ 1 帧（合成时钟 16.7ms/帧），即「按下当帧就动」。

### 缓存重建频率

压测全程 **469 次重建**（≈每走一步 1 次，`refreshFov` 触发），**不是每帧**：
`_staticRebuilds` 在空闲 5 帧内增量 0、走一步增量 1（`verify_d12` d1/d2 断言）。

## 四、修复

### 1. `js/core/render.js` — 静态图层离屏缓存（流畅度主修）

`drawMap` 拆成「缓存调度 + 原逐格代码」。原代码整段迁入新方法 `_drawSceneStatic(ctx, grid, pf, W, H)`，
绘制顺序、坐标、`floorVariantName` 变体选择、墙拼接、装饰层级、记忆覆盖、主题 tint **逐行保持原样**，只换目标 ctx。

缓存键：`grid 引用 / 楼层 / camX / camY / dpr / scale / canvas 宽高`，任一变化即重建（`_staticValidFor`）；
`resize()` 直接把 `staticCache.valid` 置 false。重建时离屏 canvas 尺寸 = `cv.width × cv.height`（设备像素），
先 `setTransform(dpr*scale,...)` 再用同一套 CSS 像素坐标绘制，每帧 `setTransform(1,0,0,1,0,0)` 后 1:1 `drawImage` —— 与直绘同一设备像素网格，逐像素一致。

视野变化（眼睛看到的记忆/未探索区域会变）通过 `main.js#refreshFov` 调 `invalidateStatic()` 失效，
即重建频率与「步」一致（≈8 次/秒），不随帧率上升。

### 2. `js/systems/lighting.js` — 暗角预渲染（流畅度次修）

原 `drawVignette` 每帧 `createRadialGradient` + 全屏 `fillRect`。改为同样参数一次性画进离屏 canvas（`vignetteKey` 按 cssW/cssH/w/h/dpr/scale 变化才重建），每帧 1 次 `drawImage` blit。
**为什么必须改它**：实测它单独占帧 28%，而它与地图渲染是两个互不相干的每帧全屏操作，只修地图只能拿回 57%。
二次合成（预渲染再 blit）与直绘存在 **±1 LSB 舍入**，肉眼不可见；`verify_d12` b) 用 `maxDelta<=1` 量化，摘掉光影时新旧指纹**完全相同**（`41b37796`）。

### 3. `js/core/input.js` + `js/core/main.js` — 输入边沿（跟手度主修）

`input.js`：keydown 时若该方向键此前未按下（`!keys[code]`，忽略系统 auto-repeat）则置 `dirEdge`，提供 `takeDirEdge()` 取走；`blur` / `clear` 复位。

`main.js#_updateExplore`：

```js
var fresh = dirDown && (dirEdge || !lastDir || d.dx !== lastDir.dx || d.dy !== lastDir.dy);
if (!dirDown) lastDir = null;
if (!fresh && tNow - lastStepAt < MOVE_INTERVAL) return;
lastStepAt = tNow;
if (dirDown) lastDir = { dx: d.dx, dy: d.dy };
if (tNow - lastAiAt >= MOVE_INTERVAL) { lastAiAt = tNow; Game.Systems.AI.tick(player); }
```

- **新按下 / 换方向 → 当帧立即走一格**（不再被窗口吞掉）；
- **同一方向按住 → 仍按 120ms 连发**（节奏手感不变）；
- 新增 `lastAiAt` 让 AI 仍按固定 120ms tick，**怪物移动节奏与玩家按键频率解耦**，相对速度/难度不变；
- **「一次输入只走一格」语义保留**：`fresh` 只在「边沿」或「换方向」时为真，按住不产生额外格；
  系统 auto-repeat 被显式忽略（`!keys[e.code]` 判定），不引入 OS 重复率相关的额外移动。

### 4. `js/core/main.js` — `refreshFov()` 里失效静态缓存

视野变了静态层就过期；放在这里而不是每帧比较，避免每帧做无意义的键比较。

## 五、断言（`preflight/verify_d12.html`）

| 断言 | 内容 |
|---|---|
| d12_a | 读 `d12-before/after.json` 同一压测断言改善：帧 P50 ≤ 改前 50%（实际 1.8 vs 11.7）、`drawImage` ≤20 且改前 ≥800（8 vs 859）、`Sprites.get` ≤20 且改前 ≥800（11 vs 867）、短按丢弃 =0、延迟 P95 <20ms（15.79）、max <20ms（16.6） |
| d12_b | **画面等价**：隐藏动态层后，「`_staticBypass` 直绘」与「离屏缓存 blit」逐像素比对。摘光影：`diffPixels=0`（严格相等）；带光影：`maxDelta<=1`（仅暗角二次合成舍入） |
| d12_c | **输入语义**：c1 短按 20 次每次恰好 1 格；c2 按住 60 帧 = 8 格（120ms 节拍）；c3 在节流窗口内 0~11 帧的 12 个相位各按一次，全部恰好 1 格（不再丢弃）；c4 按住 60 帧与每 2 帧连点 30 次的 AI tick 次数差 ≤1（7 vs 8），证明 AI 节奏不受按键频率影响 |
| d12_d | **缓存正确性**：d1 空闲 5 帧重建 0 次；d2 走一步重建恰好 1 次；d3 `setFloor(3)` 后缓存与直绘逐像素一致且画面哈希变化（无旧楼层残影）；d4 `resize(2)`（DPR 2）后仍逐像素一致，再 `resize(1)` 复原 |

## 六、不许动与回滚

未改：五层期望强度基线 `11.125 / 20.125 / 23.75 / 36.85 / 44.1`、战斗伤害公式、怪物数值、Boss 二阶段、
楼层数、存档键名 `ai_dungeon_rpg_save_v1`、移动一步一格的语义、分辨率/DPR/画布尺寸（`resize` 逻辑只加了缓存失效）、
`run-all.ps1` 的 `Get-PageVerdict`（FNV 仍 `d1f2c95f` / 785、BOM `239,187,191`）。

回滚：`git revert <commit>`。回滚后 `verify_d12` 的 a（性能）、b（缓存等价不再成立因为缓存不存在）、
c（丢弃率回到 80%）、d 均会失败——四条断言都指向本次改动。

已知不可在无头环境证明的部分见交付回报中的「缺口」。
