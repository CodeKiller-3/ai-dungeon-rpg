# D-16 战斗界面重排 + 最小特效

## 一、定位（为什么不动渲染管线）

基线 `d8e5a10`（回归 57/57）。本卡只做战斗界面，不换 DOM/引擎、不重写 Canvas2D 管线：

- 换渲染栈会同时打破 `file://` 双击可玩、逻辑坐标 `BASE 960×540` + 自适应缩放、以及 57 页回归里的坐标/像素断言，收益为负。
- 真正不够用的是 `drawBattle`：两块 90×90 贴图 + 两行文字 + 四行日志，1024×640 下中间约 240px 连续空白；`playerAction` 在同一个调用栈里跑完"玩家伤害 → 怪物反击"，两边受击反馈同帧生成，怪死了直接跳结算、没有死亡表现。

## 二、改动

| 文件 | 改动 |
|---|---|
| `js/systems/fx.js`（新增） | `Game.Fx`：顿帧 / 震屏 / 受击挤退 / 局部闪白 / 程序化斩击弧 / 技能元素色；三档 `off/low/high`；尊重 `prefers-reduced-motion` |
| `js/systems/battle.js` | 回合时间轴拆分（玩家段立即结算、怪物段由 `tick` 延时结算）、输入锁、单条指令缓冲、`catch-up`、`flush()`、`timeline()/getTimeline()`、`_setClock/_setTimeline`（验证用）；伤害飘字分级（`size`/`life`） |
| `js/core/render.js` | `drawBattle` 重排：双血条（带数值）、回合/段提示、上次行动、3 行战报、状态 chips、指令行新增 `F 特效`；接入 `Fx` 的震屏/挤退/闪白/斩击弧 |
| `js/core/main.js` | `_updateBattle`：`F` 切档位、输入锁期间 `bufferCommand` 而非丢弃；`loop(ts)` 透传帧时间戳给 `Battle.tick(ts)`、推进 `Fx.update(dt)` |
| `js/systems/feedback.js` | 飘字支持 `size`（默认 18），高伤 26/24 |
| `js/systems/modal.js` | 设置面板操作说明新增 `F 战斗特效（关/低/高）` |
| `index.html` | 在 `particles.js` 之后、`battle.js` 之前加载 `fx.js` |
| `preflight/verify_d16.html`（新增） | a~f 六组断言，19 条子断言（含 2 条负例） |
| `preflight/perf_d16.html` + `perf_d16_run.js`（新增） | CDP 真时钟压测，产物 `preflight/selfcheck/d16-perf.json` |

硬约束未动：五层期望强度 `11.125 / 20.125 / 23.75 / 36.85 / 44.1`、战斗伤害公式、怪物数值、Boss 二阶段、楼层数、存档键名与 v2 结构、零构建与 `file://` 可玩、一步一格、D-14 提示条行为。

## 三、时间轴拆分（第一优先）

### 3.1 参数

| 参数 | 值 | 含义 |
|---|---|---|
| `seg1` | 100ms | 玩家段结束到怪物段的固定间隔（两段不同帧） |
| `lock` | 150ms | 输入锁时长（玩家出手后可再次输入的时刻） |
| `total` | 180ms | 单回合表现总时长（回到 `phase='idle'`） |

单回合 ≤240ms、输入阻塞 ≤160ms 两条预算都留了余量；击杀仍走既有 700ms 消散（`dying`），不计入本预算。

### 3.2 流程

1. `playerAction(cmd)`：先 `catch-up`——上一回合若还挂着 `pending`（怪物段未结算），按它原定的 `due` 立即补结算，保证快速连按时不吞伤害。
2. 玩家伤害/技能结算在本次调用内完成（与旧行为一致），并记录 `turnRec.startedAt/playerAt/finalizeAt`。
3. 怪物段不进调用栈，登记 `pending = { due: t0 + seg1 }`，由 `tick()` 到点执行 `runMonsterSegment()`；因此玩家伤害事件与怪物反击事件的时间戳天然相差 100ms。
4. `tick()` 同时负责：记录实测 `lockMs`（解锁时刻 − `startedAt`）、到 `finalizeAt` 记录实测 `presentMs` 并回到 `idle`、执行缓冲的一条指令。
5. 不走帧循环的验证页（`verify_m8_1/m8_2`）用 `flush()` 立即跑完 `pending` 并收尾——**只用于测试，不参与真实输入路径**。

### 3.3 时钟

`now()` 三级优先级：注入时钟（`_setClock`，验证用）> 帧时间戳 `frameNow`（`tick(ts)` 更新）> `performance.now()`。这样合成的 `M.loop(vts)` 驱动（D-10 / D-15 的既有写法）与真实主循环同钟，不会出现"帧时间在涨、锁用的是墙钟"的错位。死亡消散仍用真实 `performance.now()`，与 M9-3 既有断言一致。

### 3.4 输入锁与缓冲

`_updateBattle` 解析出 `cmd` 后：若 `Battle.isInputLocked()` 为真，调 `bufferCommand(cmd)`——**只留一条、先按优先、不覆盖**、锁内绝不执行；解锁后由 `tick()` 执行一次并清空。这一层在输入层，`playerAction` 仍保持"一次一回合"。

### 3.5 实测

| 断言 | 实测 |
|---|---|
| A1 顺序 | 玩家命中 `at=100000`、怪物反击 `at=100100`（差 100ms） |
| A2 不同帧 | 两段间隔 100ms ≥ `seg1` |
| A3 负例 | `_setTimeline({seg1:0})` 后两事件 `at` 相同 → 顺序断言 **false**（证明 A1 能抓回归） |
| B1 单回合 | **180ms** ≤ 240ms |
| B2 输入阻塞 | **150ms** ≤ 160ms |
| B3 死亡 | 击杀进入 700ms 消散，超出预算属预期 |
| C1~C3 | 锁内按键写入缓冲且不执行（命中 1→1）；解锁后执行 **一次**（1→2，回合 1→2），缓冲清空 |

## 四、界面重排（消除中间空白）

| 区域（逻辑 y） | 内容 |
|---|---|
| 90~180 | 敌方精灵（`monsterPos()` 未动，底部对齐 180） |
| 202 | 敌名（保留 `【BOSS】` 前缀） |
| 212~232 | 敌方血条 + `HP 132 / 150` |
| 244~272 | `第 N 回合` + `① 你出手` / `② 怪物反击`（按 `phase` 高亮） |
| 300 | 上次行动（普通 `bold 16px`，高伤 `bold 18px #ffb347` + `【高伤】` 前缀） |
| 326 / 344 / 362 | 战报 3 行 12px |
| 378 | 状态 chips：`⚡狂暴` / `护盾 N` / `防御中` |
| 414~434 | 我方血条 + `HP 46 / 100` |
| 450~540 | 我方精灵（`H-190`，未动） |
| 562 | 攻/防/MP 属性 12px |
| `H-30` | 指令行（新增 `F 特效`） |

- 中段 `y 240~400` 现在是"回合提示 + 上次行动 + 战报 + 状态"四层信息，随战斗实时变化；不再有连续空白带。
- 未压缩地图区、未改 HUD 布局；`monsterPos/playerPos` 与反馈坐标未动。
- 字号：战斗界面实测 31 处文字，**最小 11px**（HUD 最小 9px），无 <11px 的次级文字。
- 伤害分级只做"普通 / 高伤"两档（`dmg ≥ 20` 或 `dmg ≥ 20% maxHp`），**不做暴击特写**——游戏没有暴击系统。

## 五、`Game.Fx`（程序化，零新素材）

| 档位 | 顿帧 | 震屏 | 挤退 | 闪白强度 | 闪白时长 | 斩击弧 |
|---|---|---|---|---|---|---|
| `off` | 0 | 0 | 0 | 0 | 0 | 0 |
| `low`（默认） | 50ms | 2px | 5px | 0.40 | 90ms | 0.75 |
| `high` | 80ms | 4px | 9px | 0.60 | 110ms | 1 |

- **默认 `low` 的理由**：本作是回合制文字+贴图战斗，`high` 的 4px 震屏在连续回合里更容易被视为"抖得不对"，而 `low` 仍能让人看出"这一下有反馈"；且 `low` 的顿帧 50ms 不会吃掉输入节奏（锁已 150ms）。
- **入口可达**：战斗中按 `F` 循环切档并给 `ui:notice` 提示；`Modal` 设置面板的操作说明里也写了同一行。
- **`prefers-reduced-motion: reduce`**：`effective()` 直接返回 `off`，`hit()` 返回 `false`（不产生震屏/闪白/顿帧），与档位设置无关。
- **光敏安全**：闪白是命中点局部叠加，`ms = min(配置, 120)` 硬上限、单次命中只产生一条；没有 strobe、没有高频闪烁、没有整屏闪。
- **顿帧实现**：冻结的只是"特效/动作时钟"（`clockNow = real - clockShift`），主循环不停、输入不丢。
- **明确不做**：每回合鼓点重音（150~300 次重复必成噪音）、长拖尾、为怪物新画帧动画。

## 六、性能（实测，方法与 D-12 相同）

条件：Edge headless + CDP 真实时钟，同步 rAF 驱动，每帧 `getImageData(1,1)` 强制光栅化；只包装 `drawBattle` / `update` / `Fx.update` 计时；`off/low/high` 各 400 帧（共 800 帧计入战斗统计），战斗中每 12 帧出手一次，怪物 `hp=9000 / atk=0` 避免提前结束。

| 档位 | draw P50 | draw P95 | 帧总 P50 | 帧总 P95 | drawImage |
|---|---|---|---|---|---|
| off | 0.4ms | 0.9ms | 1.5ms | 3.0ms | 4 |
| low | 0.4ms | 0.7ms | 1.5ms | 3.1ms | 4 |
| high | 0.4ms | 0.8ms | 1.6ms | 4.0ms | 4 |

- 预算 P50 ≤3ms / P95 ≤6ms：**drawBattle P50 0.40ms、P95 0.80ms**（合并 800 样本），远在预算内。
- `drawImage` 仍为 4 次/帧（两个精灵 + 两张血条贴图无关，实际为敌方帧 + 我方帧 + 2 次装饰），没有因特效新增贴图。
- `fillText` 25 次/帧（重排后信息变多，是本次唯一的常量级增量）。
- 基线（改前）约 0.7ms / 4 次 `drawImage`；改后同量级，未超预算，因此没有额外收特效参数。

## 七、验证

`preflight/verify_d16.html`（带 `preflight-meta`：读 `selfcheck/d16-perf.json`）：

| 组 | 断言 |
|---|---|
| a | `A1_playerHitBeforeMonsterHit`、`A2_twoSegmentsNotSameFrame`、`A3_negativeMergedSameFrameFails` |
| b | `B1_turnPresentationWithin240`（180ms）、`B2_inputBlockWithin160`（150ms）、`B3_deathMayExceedBudget` |
| c | `C1_keyBufferedNotDropped`、`C2_notExecutedWhileLocked`、`C3_executedExactlyOnceAfterUnlock` |
| d | `D1_offHasNoShakeNoFlash`、`D2_lowHighDistinguishable`（2 vs 4px；50 vs 80ms）、`D3_presetWithinSpec`、`D4_reducedMotionAutoDowngrade`、`D5_flashSingleLocalBurst` |
| e | `E1_bandFilledWithInfo`、`E2_bandContentChangesWithBattle`、`E3_textNotSmallerThanHud` |
| f | `F1_perfWithinBudget` |

- **e 的判定方式**：对中段条带 `y 240~400` 做 `getImageData` 像素哈希 + 拦 `fillText` 收集文本集；背景色取条带左上角像素，通道差 >12 计为"有内容"。待机 5 条文字 / 17318 非背景像素，行动后 6 条 / 19008，哈希与文本集都变。
- 回归：`TOTAL=58 PASS=58 FAIL=0 NONE=0 MIXED=0`（57 → 58，新增 `verify_d16`）。
- 静态：`selfcheck.js` 33 项 → 32 PASS / 1 WARN（QF-01 体积）/ 0 FAIL。
- `run-all.ps1` 未改：`Get-PageVerdict` 函数体 FNV 仍 `d1f2c95f` / 785；BOM `239,187,191`。
- 截图：`preflight/selfcheck/shots/D16-battle-1280x800.png`、`preflight/selfcheck/shots/D16-battle-1024x640.png`。

### 7.1 过渡轮说明（机械重跑，不是人工介入）

第 1 轮全量回归 `58 / 54 PASS / 4 FAIL`：`verify_d10`、`verify_d15`、`verify_m8_1`、`verify_m8_2`。四条都是时间轴拆分带来的**测试侧假设过期**，不是产品缺陷：

- `verify_m8_1` t8 / `verify_m8_2` t5·t6：同步调 `playerAction` 后立刻读 `state.shieldValue` / `P.hp`，而怪物段已改为下一帧结算 → 补 `B.flush()`（并在 t5 前先结清 t4 遗留的 `pending`，否则它的伤害会被算进本次吐息）。
- `verify_d10`：合成 `vts` 驱动主循环、锁却用墙钟 → `now()` 增加"帧时间戳"一级（见 §3.3）。
- `verify_d15` D 组：同一帧内连按本来就没有"第二回合"，输入锁把它变成"被缓冲" → 注入可控战斗时钟，负例前显式 `dT += 200` 越过锁窗口。

第 2 轮 `58 / 58`。**`regression-result.json` 完全由最后一轮 run-all 生成，无手工修改**（`rowsHash` 可复算）。

## 八、缺口

### 8.1 无头环境测不出的观感（需真人判定）

1. **顿帧手感**：50ms（low）/ 80ms（high）的冻结是否"像打中了"，还是像"卡了一下"，只能真人按键判断；断言只能证明时长与开关正确。
2. **震屏幅度是否过火**：2px / 4px 在 1024×640 逻辑坐标下会被 scale 放大（1280×800 时 ×1.25），实际观感需真机；连续回合叠加时是否晕需人眼确认。
3. **闪白是否刺眼**：0.40 / 0.60 的局部叠色在深色地牢背景上偏亮，尤其 high 档 110ms 连续命中；`prefers-reduced-motion` 只解决"愿不愿意看"，不解决"亮不亮"。
4. **斩击弧形状**：程序化贝塞尔弧只有三个控制点，是否像"刀光"而非"一条线"，需截图/实机比对。
5. **分段节奏**：100ms 间隔是否够让人看清"先是玩家、再是怪物"，还是显得拖；180ms 总时长在连续快速输入下是否烦。

### 8.2 其它

- **两档截图内容相同**：1280×800 与 1024×640 都落在逻辑 `1024×640`（scale 1.25 / 1.0），像素密度不同但布局一致——这是既有自适应缩放的设计结果，不是重排失效。真机高 DPI（dpr 2）未截图核验。
- **输入缓冲只有一条**：锁内连按两次只执行第一条（先按优先），这是卡面"缓冲一条"的直读实现；若真人觉得"第二下没反应"，需改为队列（会拉开回合节奏）。
- **死亡/胜利仍 700ms**，未按新时间轴重做。
- 闪白、震屏的像素级断言只在离屏 canvas 上做，未在真实合成器下验证。
- Pages 线上**未核验**（沙箱不可达，按 §6.1 第 2 条如实记录）。

## 九、不许动与回滚

- 不许动：五层期望强度、战斗伤害公式、怪物数值、Boss 二阶段、楼层数、存档键名与 v2 结构、零构建与 `file://` 可玩、一步一格、D-14 提示条行为、`Get-PageVerdict`。
- 回滚：`git revert <commit>`；`fx.js` 可整文件删除（渲染层全部 `Game.Fx &&` 守卫，删掉即回到无特效），`battle.js` 的 `pending/tick` 与 `_updateBattle` 的锁需要一起回退，否则怪物段不会结算。
