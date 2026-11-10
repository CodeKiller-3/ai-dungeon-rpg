# D-05 自检工具的误报 / 静默失效收口

> 卡号：D-05（让自检只在数据错时报警、让证据截图不再被静默忽略）
> 前置：D-02 已交付 `c314ec8`（README/讲稿补正，45/45）
> 定位：工具层收口。不改业务代码、不改已定口径的判定强度、不改任何数字/基线。

## 一、玩家可见行为

- 游戏本体零变化（`js/` 不参与本卡）。
- 变化只在自检工具与版本库卫生：
  1. `selfcheck.js` 的 XC-01 不再因「48 件 / 48 条」措辞不同而误报，写错数字（如 47）直接 FAIL；
  2. `verify_c05.html` 的 C5-5 不再依赖固定句式，改用「解析百分数 + 与实测值集合比对」；
  3. `.gitignore` 不再吞掉 `D-02` 及之后各卡的证据截图。

## 二、实现方式

### 子项 1：XC-01 数字解析

- 新增 `preflight/lib/assert-data.js`（浏览器 + Node 双端可用），导出 `parseItemCounts / checkItemCount`。
- 解析两种写法：「物品全表 48 件」「物品 48 条」（另兼容「物品共 N 件」「N 件物品」），数字与 `ITEMS` 实际条数逐一比对；**解析不到声明也判不通过**，避免检查被悄悄跳过。
- `selfcheck.js` 改为 `require('../lib/assert-data.js')`；物品不一致由 WARN 升为 **FAIL**（按卡面要求），怪物/任务/楼层仍维持原 WARN 口径。

### 子项 2：C5-5 数据驱动

- `assert-data.js` 导出 `checkC55(readme, speech, expect)`：
  - 只扫描 Q-learning 段落（README 含 `Q-learning` 的行；讲稿 §三.4 整节）；
  - 解析段落内全部百分数；
  - 六个实测值（Q 中位数 22、区间端点 9/31；随机中位数 5、端点 2/12）必须都出现；
  - 段落内不得出现白名单外的百分数（白名单 = 上列 6 值 + `17`，17 是 D-02 演示页快照值）；
  - 中位数必须落在各自区间内（9 ≤ 22 ≤ 31、2 ≤ 5 ≤ 12）。
- `verify_c05.html` 的 C5-5 改为调用该实现；C5-1~C5-4、随机基线口径、7 图种子、60 步上限全部不动。

### 子项 3：`.gitignore` 收窄

- 由 `preflight/selfcheck/shots/D-0*.png` 收窄为 `preflight/selfcheck/shots/D-01*.png`。
- 理由：`D-0*` 会连 `D-02`、`D-03`… 的证据截图一并忽略（D-02 已被迫改名为 `D02-*.png` 规避）；实际不打算入库的只有 D-01 / D-01b 两张早期交接截图。采用"白名单式收窄"而非删除规则，保留这两张的本地忽略状态。

### 证据文件

`preflight/selfcheck/d05-evidence.json`：记录三条负例的真实运行输出（D5-2 / D5-4 / D5-5）与 D5-3 的正例结果，供 `verify_d05.html` 断言与事后复查。

## 三、不许动

- `js/` 任何文件。
- `verify_c02` / `c03` / `c03b` / `c04` / `d02` 的判定强度。
- README / 讲稿的数字与措辞（负例测试时临时改动，跑完立即还原，不入库）。
- 任何价格、属性、怪物数值、五层期望强度基线、楼层数、存档键名。
- 不为了让负例通过而放宽 C5-5 白名单（17 属演示页口径，D-02 已入库，非本卡放宽）。

## 四、断言表（`preflight/verify_d05.html`）

| 编号 | 名称 | 判定口径 |
|---|---|---|
| D5-1 | `xc01BothPhrasings` | 用共享解析器对「物品全表 48 件」「物品 48 条」两种写法分别校验，均 `ok=true` 且解析值为实际条数 |
| D5-2 | `xc01CatchesWrongNumber` | 把声明改成 47 时共享解析器 `ok=false`；并读取 `d05-evidence.json` 中真实 `selfcheck.js` 的 `[FAIL] XC-01` 原文 |
| D5-3 | `c55ParsesNumbers` | 用改写句式（换连接词、换语序）的文档文本调用 `checkC55` 仍 `ok=true`；证据文件记录真实 `verify_c05` 改写后 PASS |
| D5-4 | `c55CatchesWrongNumber` | 把 22 改成 23 时 `checkC55` 返回 `ok=false` 且给出 23 越界/缺 22；证据文件含真实 FAIL 原文 |
| D5-5 | `c55Whitelist` | 段落内加入白名单外百分数（45%）时 `ok=false`；证据文件含真实 FAIL 原文 |
| D5-6 | `gitignoreNarrowed` | 读 `.gitignore`：无 `D-0*.png`、有 `D-01*.png`；payload 附三条 `git check-ignore` 的命令与实测输出 |
| D5-7 | `noRegression` | 读 `regression-result.json`：TOTAL=46 / PASS=46 / FAIL=0 / NONE=0 / MIXED=0；读 `selfcheck-result.json`：32 PASS / 1 WARN / 0 FAIL |

## 五、完成定义

1. 三处修改落地 + 共享库 + 证据文件。
2. `node --check preflight/selfcheck/selfcheck.js preflight/lib/assert-data.js` 通过。
3. `verify_d05.html` PASS；`verify_c05.html` 在原文与改写句式下均 PASS，在 23 / 45% 两个负例下 FAIL。
4. `run-all.ps1 -Budget 3500`：**TOTAL=46 PASS=46 FAIL=0 NONE=0 MIXED=0**。
5. `selfcheck.js`：32 PASS / 1 WARN / 0 FAIL。
6. 截图：本卡无界面变更，按"无界面变更"省略并说明理由。
7. 一个含 D-05 的 commit 推送；`?v=<commit>` 核验，不通写「线上未核验」。
8. `规划-对标补齐.md` 回填 D-05，§八 基线刷到 46/46，§6.1 补「证据截图一律入库」。

## 六、取舍与已知缺口

1. **NC-01 物品用 FAIL、其他计数仍 WARN**：卡面只要求物品数字不一致必须 FAIL；怪物/任务/楼层维持原口径，避免顺手改判定强度。
2. **C5-5 白名单包含 17**：D-02 已把演示页快照 17% 写进 README/讲稿，若白名单只含离线 6 值会立刻误报。白名单按"离线六值 + 演示页快照"定义，并在 page 输出中列明，后续新增口径需同步登记。
3. **"中位数落在区间内"的实现**：文档已无固定句式，无法可靠反解哪两个数字分别是中位数与端点；因此校验的是"六个实测值都出现 + 实测中位数落在实测区间内 + 段落无越界百分数"。这能抓住 22→23、插入 45% 这类篡改，但抓不住"把 9 和 31 对调"这类同集合置换（数值集合不变）。
4. **plan 仍要求 `44/44`**：C5-5 的 plan 检查保留 C-05 节历史基线字符串，属历史记录，不改。
5. **`.gitignore` 收窄后**：仅 D-01 / D-01b 仍被忽略，没有其他历史截图变为可入库；D-02 截图已按 `D02-*.png` 入库，无需改名回滚。
