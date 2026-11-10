# D-11 游玩中卡死（无法继续）定位与修复

## 一、定位

真人反馈「游玩过程中会卡顿，不能继续游玩下去」——进程级卡住、只能刷新。

**根因（一句话）**：`js/core/main.js` 的 `start()` 把 `requestAnimationFrame(loop)` 放在 `self.loop(ts)` **之后**，任意一帧内出现未捕获异常（绘制/更新/子模块）都会让下一帧不再注册，rAF 链永久中断 → 画面定格、输入全失效。

修复前源码（`bb1e787`）：

```js
start: function () {
  var self = this;
  requestAnimationFrame(function loop(ts) {
    self.loop(ts);
    requestAnimationFrame(loop);   // ← 一旦上一行抛错，这行永远执行不到
  });
},
```

## 二、静态排查（逐项判定）

| 候选 | 判定 | 依据 |
|---|---|---|
| `Main.loop` 的 rAF 链 | **是根因** | 续帧语句在 `loop()` 之后且无 try/catch；A/B 实测旧写法注入异常后停在第 1 次调用 |
| `map.js` 生成重试 `while` | 否 | 房间/走廊/楼梯/加密室均为有界重试（`findOpen` 200 次、密室 40 次，失败即降级）；7 种子 × 5 层生成耗时 0.2–4.4ms |
| `ai.js` 寻路 / `fov.js` | 否 | 寻路走 A*，无“目标不可达仍继续搜索”的循环；6286 步内 0 异常、0 超 15s 帧 |
| `learner.js` 同步训练 | 否（但注意） | 只每帧 `tick(8)` 有界训练，不在主线流程；`randomOpen` 有界 300 次 |
| `save.js` | 否 | 只在事件点（换层/重开/战斗结束）调用，非每帧；不含整图序列化循环 |
| `render.js` / `sprites.js` / `lighting.js` | 否 | 全库仅 `lighting.js:69` 一处 `createElement('canvas')`，且为 init 预建；渐变对象复用，不每帧新建 |
| `modal.js` / `hud.js` / `battle.js` 状态卡死 | 否 | gameover 有键盘/点击重开路径（D-10 已验）；本次实测弹窗 56 次开合无残留 |

## 三、压测取证（修复前）

一次性诊断页 `preflight/diag_d11.html`（未提交）：

- 7 个固定随机种子（11/23/37/41/53/67/79），每个种子按 5 层生成；
- 每种子 800 步真实键盘移动 + 多次换层 + 商店/背包/任务/设置开合；
- 共 **6286 次驱动步、21 场战斗（含 Boss）、28 次换层、56 次弹窗**；
- 结果：**自然异常 0**；帧耗时 6132/6286 < 16ms，122–137 帧 > 100ms，单帧最大 210–453ms（headless 软件绘制的抖动，非永久卡死）。

结论：正常输入序列下没有稳定触发的异常；但**任何一次**潜在异常都会触发第一节的永久停帧，这正是用户看到的现象类别（无法继续、只能刷新）。真实 rAF 在 headless 下会被节流，不能作为链路证据（修复前后第二个 400ms 都是 0 帧），改用假 rAF A/B 复现。

## 四、修复

只改 `js/core/main.js` 的 `start()`：`loop` 外包 `try/catch`，捕获后记录 `_errorCount` / `_lastError`（msg/stack/scene/时间），**无条件** `requestAnimationFrame(loop)`。正常路径（无异常）不改变任何行为与耗时。

不改：数值、伤害公式、怪物/Boss、期望强度、楼层、存档键名、其他模块；不把卡死改成自动重开。

## 五、断言（`preflight/verify_d11.html`）

| 断言 | 内容 |
|---|---|
| d11_1 | `main.js` 的 `start()` 在 try 内调 `loop`，catch 记录 `_errorCount`/`_lastError`，catch 之后无条件续帧 |
| d11_2 | 诊断证据：7 种子、6286 步、0 自然异常、21 战斗、56 弹窗、28 换层、每层生成 ≤50ms、最大帧 ≤15s |
| d11_3 | 受保护口径：`run-all.ps1` BOM `239,187,191`、`Get-PageVerdict` FNV `d1f2c95f` / 785 |
| d11_4 | **复现**：假 rAF 下复刻旧写法，注入异常后 5 次泵帧只执行 1 次（链断） |
| d11_5 | **不复存在**：同一注入异常下，现写法连续泵 30 帧全部执行、`_errorCount=1`、错误信息被记录；恢复绘制后再泵 5 帧继续执行，场景仍为 explore |

## 六、不许动与回滚

- 不回改既有验证页口径；不动 `Get-PageVerdict`；不动数值/存档/楼层。
- 回滚：`git revert <commit>`；`start()` 恢复旧写法后 d11_4/d11_5 会失败。
