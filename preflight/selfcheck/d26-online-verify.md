# D-26 线上核验欠账清零（Pages 运行时核验）

- 基线 commit：`66a2381`（本地回归 67/67）
- 生成时间：2026-11-11T22:24:26+08:00
- 机器可读产物：`preflight/selfcheck/d26-online-verify.json`
- 页面 URL 模板：`https://codekiller-3.github.io/ai-dungeon-rpg/preflight/<page>.html?v=66a2381`

## 0. 方法与限制（先说清楚，避免误读）

1. **本机 shell 无外网**：`Test-NetConnection codekiller-3.github.io -Port 443` 对 3 个 GitHub Pages IP 全部失败，Edge headless 直连返回空 DOM、`HTTP=0`。因此**无法**用 `run-all.ps1` 那套 headless 在本机跑线上页。
2. 实际采用的通道：**会执行页面 JS 的 WebFetch**。它对 `verify_smoke.html` 返回了运行期结果（`smokeOk:true, errors:[]`），证明裁决行是运行时生成、不是静态 HTML。
3. 该通道**不暴露 HTTP 状态码**，也**不暴露 console/pageerror**。所以本表 `HTTP` 一列记 `n/a（可达=取到内容）`，`JS_ERRORS` 用 `verify_smoke` 的 `errors:[]` 作替代证据，均如实标注、不伪造。
4. 通道对**子资源**命中了旧版 `js/core/render.js`（详见 §3.1），导致引导页相关 3 页显示 FAIL —— 这是缓存伪影，不是线上文件坏了。

## 1. 汇总

| 指标 | 数量 |
|---|---|
| 核验页面总数 | 67 |
| 线上可判定且 PASS | **51** |
| 线上可判定且 FAIL | **15** |
| 拿不到裁决行（NONE） | **1**（verify_d18） |
| 其中：旧子资源缓存伪影 | 3（d20 / d24 / d25） |
| 其中：依赖本地产物的元页面 | 5（d05 / d06 / d09 / d15b / d22） |
| 其中：取证通道渲染环境差异 | 7（m9_2 / m9_5 / p2_3 / resize / s02a / s3_4 / selfcheck） |

入口页：`index.html?v=66a2381` **可达**（返回页面正文）。`JS_ERRORS`：该通道无 console 捕获，记 `null`；替代证据 `verify_smoke` 线上 `errors:[]`、`rafFrames:8`、`scene:explore`。

## 2. 逐页结果

| # | 页面 | 线上裁决 | 分类 | 备注（失败项 / 依据） |
|---|---|---|---|---|
| 1 | verify_c02 | PASS | ok |  |
| 2 | verify_c03 | PASS | ok |  |
| 3 | verify_c03b | PASS | ok |  |
| 4 | verify_c04 | PASS | ok |  |
| 5 | verify_c05 | PASS | ok |  |
| 6 | verify_d02 | PASS | ok |  |
| 7 | verify_d05 | FAIL | meta | d56_gitignoreNarrowed、d64_d05Reverted（读台账/产物） |
| 8 | verify_d06 | FAIL | meta | d64_d05Reverted（同源） |
| 9 | verify_d07 | PASS | ok |  |
| 10 | verify_d08 | PASS | ok |  |
| 11 | verify_d09 | FAIL | meta | d98_currentRunProvenance（runId=null） |
| 12 | verify_d10 | PASS | ok |  |
| 13 | verify_d11 | PASS | ok |  |
| 14 | verify_d12 | PASS | ok |  |
| 15 | verify_d13 | PASS | ok |  |
| 16 | verify_d14 | PASS | ok |  |
| 17 | verify_d15 | PASS | ok |  |
| 18 | verify_d15b | FAIL | meta | M1_ledgerCurrentRun（myRun=(none)） |
| 19 | verify_d16 | PASS | ok |  |
| 20 | verify_d17 | PASS | ok |  |
| 21 | verify_d18 | NONE | unreachable | 通道三次返回空内容 |
| 22 | verify_d19 | PASS | ok |  |
| 23 | verify_d20 | FAIL | stale | B7_equipHowTo、B0（引导页 13 行，旧 render.js） |
| 24 | verify_d21 | PASS | ok |  |
| 25 | verify_d22 | FAIL | meta | artifact=768b758b ≠ computed=94740197；F3_bomKept |
| 26 | verify_d23 | PASS | ok |  |
| 27 | verify_d24 | FAIL | stale | C2/C4（引导页 13 行，旧 render.js） |
| 28 | verify_d25 | FAIL | stale | A1/A2/A4（13/13/13，期望 14） |
| 29 | verify_m1 | PASS | ok | no-ok-field |
| 30 | verify_m2 | PASS | ok |  |
| 31 | verify_m3 | PASS | ok |  |
| 32 | verify_m4 | PASS | ok |  |
| 33 | verify_m5 | PASS | ok | no-ok-field |
| 34 | verify_m7 | PASS | ok | no-ok-field |
| 35 | verify_m8_1 | PASS | ok |  |
| 36 | verify_m8_2 | PASS | ok |  |
| 37 | verify_m8_3 | PASS | ok |  |
| 38 | verify_m8_4 | PASS | ok |  |
| 39 | verify_m8_5 | PASS | ok |  |
| 40 | verify_m8_6 | PASS | ok |  |
| 41 | verify_m9_1 | PASS | ok |  |
| 42 | verify_m9_2 | FAIL | env | t3_torchGlow（画布像素类） |
| 43 | verify_m9_3 | PASS | ok |  |
| 44 | verify_m9_4 | PASS | ok |  |
| 45 | verify_m9_5 | FAIL | env | t2_dpr1（DPR/渲染类） |
| 46 | verify_p1_1 | PASS | ok |  |
| 47 | verify_p1_2 | PASS | ok |  |
| 48 | verify_p1_3 | PASS | ok |  |
| 49 | verify_p1p2 | PASS | ok |  |
| 50 | verify_p2_1 | PASS | ok |  |
| 51 | verify_p2_2 | PASS | ok |  |
| 52 | verify_p2_3 | FAIL | env | t4_monster15、t5_drawMap、t9_fallback（绘制/贴图类） |
| 53 | verify_p2_3b | PASS | ok |  |
| 54 | verify_p2_4 | PASS | ok |  |
| 55 | verify_p2_5 | PASS | ok |  |
| 56 | verify_resize | FAIL | env | resizeRepeatable |
| 57 | verify_s01_shop | PASS | ok |  |
| 58 | verify_s02a | FAIL | env | spriteOk、pixelOk、alphaOk（贴图解码） |
| 59 | verify_s03 | PASS | ok |  |
| 60 | verify_s04 | PASS | ok |  |
| 61 | verify_s05 | PASS | ok |  |
| 62 | verify_s3_1 | PASS | ok |  |
| 63 | verify_s3_2 | PASS | ok |  |
| 64 | verify_s3_3 | PASS | ok |  |
| 65 | verify_s3_4 | FAIL | env | t5（特效绘制） |
| 66 | verify_selfcheck | FAIL | env | p8_draw（画布快照） |
| 67 | verify_smoke | PASS | ok | `errors:[]`、`rafFrames:8` |

## 3. 三类 FAIL 的归因

### 3.1 旧子资源缓存伪影（3 页，**不是线上坏了**）

- 现象：`verify_d25` 线上 `A4_fourteenRows = 13/13/13`，即页面执行时读到的 `guideRows()` 还是 D-25 之前的 13 行。
- 反证：对同一路径 `https://codekiller-3.github.io/ai-dungeon-rpg/js/core/render.js`（带 `?v=66a2381b` 与不带 query 各取一次）**都能取到含「装备：捡到或买到武器/护甲后…」的新文件**。
- 结论：部署未回退，HTML 也是新版（d25 独有的 A1/A6 断言都在跑）；只是取证通道把旧版 `js/core/render.js` 喂给了页面。真实用户强刷即可拿到新版。
- 影响页：`verify_d20`（B7 文案=false）、`verify_d24`（C2/C4）、`verify_d25`（A1/A2/A4）。这三页的其余断言全部通过，与"只有渲染引导页那一份文件是旧的"一致。

### 3.2 依赖本地产物的元页面（5 页，线上无法判定）

`d05 / d06 / d09 / d15b / d22`：断言依赖本轮 `runId` 台账、`d22-selftest.json` 产物与 BOM 字节。线上没有"本轮运行"这回事，`runId=null`、`artifact` 与 `computed` 必然不等。**不计入线上失败**，也不代表功能回归。

### 3.3 取证通道渲染环境差异（7 页，不作线上坏处理）

`m9_2 / m9_5 / p2_3 / resize / s02a / s3_4 / selfcheck`：失败项全部集中在贴图解码、画布像素采样、画布快照、DPR 一类。同一批页面在本地 headless `run-all.ps1 -Budget 3500` 下 67/67 全过。判定为取证通道的渲染环境差异，需要一台真浏览器 + 外网才能最终定论。

## 4. 历史欠账清单（此前标"未核验"的 commit）

> Pages 只服务**最新**版本，`https://…/ai-dungeon-rpg/<path>` 没有"按 commit 取旧文件"的能力（`?v=` 只是查询串，不改变内容）。所以**旧版本身一律无法回看**。下表"间接可核验"指：该改动若仍在最新线上生效，其对应验证页在线上应 PASS。

| commit | 主题 | 旧版回看 | 本次结论 |
|---|---|---|---|
| `.gitignore`（f4f9ee9） | D-05 自检工具收口 | 不能 | 不可判定：verify_d05 线上读台账，属元页面 |
| `shop.js`（3458cda） | C-02 商店刷新相位/轮换池 | 不能 | 间接可核验：verify_s01_shop 线上 PASS |
| `modal.js`（eb69ced） | D-20 引导页按键表同源 | 不能 | 间接可核验：verify_d20 线上 B1–B6 全 true、B7 代码=true（仅文案因旧 render.js 失败） |
| `items.js`（38fd2a3） | C-04 两件 240 档装备 | 不能 | 间接可核验：verify_c04 线上 PASS |
| 2d5c29f | C-05 Q-learning 随机基线 | 不能 | 间接可核验：verify_c05 线上 PASS |
| f4f9ee9 | D-05 收口 | 不能 | 不可判定（元页面） |
| 00c58e0 | D-06 run-all 判定修正 | 不能 | 不可判定（元页面） |
| 461d6d1 | D-07 FR-08 合成标注 | 不能 | 间接可核验：verify_d07 线上 PASS |
| 26cfa3f | D-08 汇总计数 | 不能 | 间接可核验：verify_d08 线上 PASS |
| 7a5e03c | D-09 元页面声明式标记 | 不能 | 不可判定（元页面） |
| bb1e787 | D-10 三局 E2E | 不能 | 间接可核验：verify_d10 线上 PASS |
| 82611fd | D-11 单帧异常不打断 rAF | 不能 | 间接可核验：verify_d11 线上 PASS |
| 63d751e | D-12 静态图层缓存/输入边沿 | 不能 | 间接可核验：verify_d12 线上 PASS |
| efe1df2 | D-13 TD 更新对象 | 不能 | 间接可核验：verify_d13 线上 PASS |
| f30f438 | D-14 底部提示条 | 不能 | 间接可核验：verify_d14 线上 PASS |
| 0b82f0f | D-15 逃跑不删怪等 | 不能 | 间接可核验：verify_d15 线上 PASS |
| d8e5a10 | D-15b 溯源与存档实测 | 不能 | 不可判定（台账元页面） |
| 379d880 | D-16 战斗时间轴/重排 | 不能 | 间接可核验：verify_d16 线上 PASS |
| 48cd587 | D-21 素材审计/骑士空帧 | 不能 | 间接可核验：verify_d21 线上 PASS |
| f1a9015 | D-22 页数兜底防线 | 不能 | 不可判定（依赖 selftest 产物） |
| 9a75598 | D-23 死亡归因遥测 | 不能 | 间接可核验：verify_d23 线上 PASS |
| acb250d | D-24 赤手成因核查 | 不能 | 不可判定：verify_d24 命中旧 render.js 缓存 |
| 66a2381 | D-25 引导页装备行 | 不能 | 不可判定：同上；但 `js/core/render.js` 直接 GET 已含新行，证明已部署 |

## 5. 结论

- 线上**可达**，67 页里 **51 页**在线上直接 PASS，说明绝大多数机制在真实部署环境成立。
- 15 个 FAIL 中，**0 个可判定为"线上真的坏了"**：3 个是旧子资源缓存伪影（且有直接 GET 反证），5 个是元页面依赖本地产物，7 个是取证通道渲染环境差异。
- **1 页**（verify_d18）本次拿不到裁决行，如实记为 NONE。
- 仍然欠着的：一台"真浏览器 + 外网 + 强刷缓存"的复跑，用来把那 3 个缓存伪影和 7 个环境差异彻底钉死。本机 shell 无外网，这条做不到。
- 落盘后的本地回归（与线上结论分开记）：`run-all.ps1 -Budget 3500` → `TOTAL=68 PASS=68 FAIL=0 NONE=0 MIXED=0`、`GUARD=OK expected=68 actual=68`；`selfcheck.js` → `FAIL=0`（1 条既有 WARN：QF-01 单文件体积）。新增 `verify_d26` 只做产物一致性校验，不重复线上取证。
