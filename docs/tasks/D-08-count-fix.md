# D-08 汇总计数在单条时打印空白

## 一、定位

`run-all.ps1` 的汇总行（`TOTAL= / PASS= / FAIL= / NONE= / MIXED=`）在结果**恰好 1 条**时打印空白，会让「一页失败」看起来像「零失败」。本卡只修计数与取值路径，不改裁决逻辑、不改任何验证页的判定口径、不动业务代码与文档数字。

## 二、缺陷与根因（两个叠加问题）

1. **裸 `.Count`**：`(... | Where-Object {...}).Count` 在 PowerShell 中，结果恰好 1 条时 `Where-Object` 返回的是单个对象（PSCustomObject），不是数组；对 PSCustomObject 取 `.Count` 得到空值 → 汇总打印为空白。D-07 首次失败时实测 `FAIL=` 为空。
2. **变量名撞车（本卡实测新发现）**：D-08 为取证新增开关 `[switch]$Summary` 后，主流程里既有的 `$summary = ...` 与它是**同一个变量**——PowerShell 变量名不分大小写。赋值时触发 `SwitchParameter` 类型转换异常：
   `Cannot convert value "System.Management.Automation.PSCustomObject" to type "System.Management.Automation.SwitchParameter"`，
   异常被 `$ErrorActionPreference='Continue'` 吞掉后，汇总行整行空白并污染 `regression-result.json`。
   复现：`param([switch]$Summary)` 下 `$summary = [pscustomobject]@{...}` 必抛该错；改名 `$sum` 即正常。

因此修法有两条约束：计数一律 `@(...).Count`；脚本**不能再有**名为 `$Summary` 的开关。

## 三、改动

- `preflight/selfcheck/run-all.ps1`
  - 新增 `Get-RegressionSummary -Rows`：`total/pass/fail/none/mixed` 五处计数全部 `@(...).Count`；`at` 字段保留。
  - 主流程与 `-VerdictFile` 分支统一调用该函数；打印模板与顺序**逐字符未变**（`TOTAL=$($summary.total) PASS=… MIXED=$($summary.mixed)`，取证分支沿用 `$s`）。
  - 开关参数名 `-Summary` → `-ShowSummary`，避免与 `$summary` 撞名；并在主流程处写明原因，防止后人改回。
  - `Get-PageVerdict` 函数体**零改动**（FNV-1a 前后一致）。
  - 文件保持 UTF-8 BOM（首三字节 `239,187,191`）。
- `preflight/selfcheck/d08-evidence.json`：三种单条场景的真实输出、退出码、汇总行、FNV 与 BOM 证据。
- `preflight/verify_d08.html`：D8-1~D8-7。
- `规划-对标补齐.md`：新增 D-08 小节；§八 基线刷到 49/49（前序 `461d6d1`）；§6.1 新增「汇总计数必须用 `@(...).Count`」。
- `README.md` / `docs/答辩讲稿.md` / `js/`：零改动。

## 四、断言与比对方式

| 断言 | 内容 | 证据/比对方式 |
|---|---|---|
| D8-1 | 单条 FAIL → `FAIL=1`、exit 1 | `-VerdictFile <tmp>/only_fail.html -ShowSummary` 实际输出 `TOTAL=1 PASS=0 FAIL=1 NONE=0 MIXED=0` |
| D8-2 | 单条 NONE → `NONE=1` | 实际输出 `TOTAL=1 PASS=0 FAIL=0 NONE=1 MIXED=0` |
| D8-3 | 单条 MIXED → `MIXED=1` | 实际输出 `TOTAL=1 PASS=0 FAIL=0 NONE=0 MIXED=1` |
| D8-4 | 汇总行格式与顺序未变 | 全量回归实跑行 `TOTAL=49 PASS=49 FAIL=0 NONE=0 MIXED=0` 匹配 `^TOTAL=\d+ PASS=\d+ FAIL=\d+ NONE=\d+ MIXED=\d+$`，且两处打印模板字符串仍在源码中 |
| D8-5 | 裁决逻辑未改 | 截取 `function Get-PageVerdict { … }` 函数体（至行首 `}`，CRLF→LF），FNV-1a 32 位：落卡前 `d1f2c95f` / 落卡后 `d1f2c95f`，长度 785；并核对四条关键片段（`$hits[$hits.Count - 1]`、`-contains 'PASS'`、`-contains 'FAIL'`、`$hits.Count -eq 0`），且源码不含 `"ok"\s*:\s*false` 扫描 |
| D8-6 | BOM 保持 | `([IO.File]::ReadAllBytes(...))[0..2] -join ','` = `239,187,191` |
| D8-7 | 无退化 | 全量回归 `TOTAL=49 PASS=49 FAIL=0 NONE=0 MIXED=0`；`selfcheck.js` 32 PASS / 1 WARN / 0 FAIL |

取证样例的三个写法坑（已避开，记录备查）：

1. 样例必须按 `--dump-dom` 的**多行结构**书写，裁决行独占一行；否则行首标签剥离 `^(?:<[^>]*>)+` 会在标签间文本处停下，整页落成 NONE。
2. 样例用 UTF-8 **无 BOM** 写入：BOM 字符不是 `<`，会使行首标签剥离失效。
3. PS 双引号串里 `$nlFAIL` 会被解析成变量 `nlFAIL`（空），须写 `${nl}FAIL`。

## 五、取舍与覆盖面（如实记录）

- `-ShowSummary` 是 D-08 自建的取证开关（卡面只要求复用 D-06 的 `-VerdictFile`），因此可以自由改名；`$summary` 变量名**不能改**——D6-6 与 D8-4 都以 `TOTAL=$($summary.total) …` 这一模板串做源码比对，改名等于回退既有断言。
- 元页面互读问题在本卡再扩一张：`verify_d08` 也读上一轮 `regression-result.json`，而 `verify_d05/d06/d07` 的排除集合只含 `{d05,d06,d07}`，**未包含 `d08`**。本卡按「不改任何 `verify_*.html`」执行，未去动三张旧页面的排除表。
- 后果（已知收窄）：若某一轮 `verify_d08` 为 FAIL，则下一轮 d05/d06/d07 会连带 FAIL；再下一轮自动恢复（d08 自身排除全部元页面）。实测本卡期间出现过一次 `PASS=48 FAIL=1`（`verify_d06` 读上一轮 JSON），下一轮即收敛到 49/49。**结论仍然有效，但「单轮即可 49/49」不成立，需允许一轮收敛。**
- 未做的替代方案：把 `verify_d08` 加入三张旧页面的 `META` 排除表——一行即可消除一轮延迟，但违反卡面「不改任何 `verify_*.html`」，故留作后续卡的候选。

## 六、不许动与回滚

- 不许动：`Get-PageVerdict` 三条裁决规则（只认裁决行 / 取最后一条 / PASS+FAIL 才 MIXED）、任何既有 `verify_*.html` 的判定口径、`js/`、README 与讲稿数字、`run-all.ps1` 的 UTF-8 BOM。
- 回滚：`git revert <commit>`；汇总退回裸 `.Count` 并恢复 `[switch]$Summary`，回归页数回到 48。
