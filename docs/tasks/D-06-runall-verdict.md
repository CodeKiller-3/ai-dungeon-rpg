# D-06 run-all.ps1 判定逻辑修正

## 一、定位

`preflight/selfcheck/run-all.ps1` 原先用「payload 含 `"ok":false`」判 MIXED，把**任何合法输出 `false` 字段的页面**误判为 MIXED（D-05 的负例证据因此被迫把 `ok` 改名为 `pass`）。这是字符串子串判定代替结构化判定带来的假信号，与 D-05 修掉的"绑句式"是同一类病。本卡只改判定逻辑，不改任何验证页的断言强度、不改 `js/`、不改文档数字。

## 二、子项

1. 逐页裁决只认页面输出的**独立裁决行**（行首可为 `PASS {json}` / `FAIL {json}`，允许前置 HTML 标签），多条取**最后一条**；不再扫描 payload 内部字段。
2. `MIXED` 重新定义：仅当同一页同时出现 PASS 与 FAIL 裁决行（页面自相矛盾）时判 MIXED；无裁决行判 `NONE`。
3. `-Budget` 超时行为、汇总行 `TOTAL= / PASS= / FAIL= / NONE= / MIXED=` 格式保持不变。
4. 把 D-05 为规避误判而改名的 `pass` 字段恢复为 `ok` 原语义，负例记录仍为"预期为假"。

## 三、实现

- `run-all.ps1` 新增 `Get-PageVerdict`：
  - 按行切分，逐行去掉行首 HTML 标签后匹配 `^\s*(PASS|FAIL)\s+\{`；
  - 收集全部裁决行，取最后一条的裁决与 JSON payload；
  - 若裁决集合同时含 PASS 与 FAIL → `MIXED`；为空 → `NONE`。
- 新增 `-VerdictFile <path>` 只解析不启动浏览器的取证模式，供 D6-1~D6-3 生成真实样例输出。
- `verify_d05.html` 三处负例字段 `pass:` → `ok:`，注释改为说明"payload 里的 false 是数据，不是裁决"。
- 文件保持 **UTF-8 BOM**（PowerShell 5.1 无 BOM 会 ParseError）。

## 四、断言与负例

| 断言 | 内容 |
|---|---|
| D6-1 | 仅 PASS / 仅 FAIL / PASS 后 FAIL 三份样例 → `PASS` / `FAIL` / `MIXED` |
| D6-2 | payload 含 `"ok":false` 但裁决行为 PASS → `PASS`（核心回归） |
| D6-3 | 无裁决行 → `NONE` |
| D6-4 | `verify_d05.html` 字段已回退；D5-2/D5-4/D5-5 负例仍成立；该页裁决 PASS |
| D6-5 | 全量回归 47/47（本页读上一轮 JSON，排除自身行） |
| D6-6 | 汇总行格式与 summary 键未变 |

样例与脚本输出记录在 `preflight/selfcheck/d06-evidence.json`，临时样例文件用后删除。

## 五、不许动

- 不改任何 `verify_*.html` 的判定口径与断言强度（除子项 4 的字段回退）。
- 不改 `js/`、README/讲稿数字、`selfcheck.js` 检查强度。
- 不删任何负例；不为让样例通过而放宽 MIXED 定义。

## 六、回滚与验证

- 回滚：`git revert <commit>` 即恢复旧判定；`verify_d06.html` 随之失效。
- 验证：`verify_d06` D6-1~D6-6 全 PASS；`run-all.ps1 -Budget 3500` 打印 `TOTAL=47 PASS=47 FAIL=0 NONE=0 MIXED=0`；`selfcheck.js` 32 PASS / 1 WARN / 0 FAIL；`run-all.ps1` BOM 校验为 `239,187,191`。
