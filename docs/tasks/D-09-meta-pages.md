# D-09 元页面改为声明式身份，消除「一轮收敛」

## 一、定位

D-08 把 `verify_d08` 变成元页面后，`verify_d05/d06/d07` 的排除集合仍写死为 `{d05,d06,d07}`，于是任一轮 `verify_d08` 判 FAIL，次轮三张旧页连带 FAIL、再次轮自动恢复。这个"一轮抖动"会把真实的元页面缺陷伪装成临时故障——与本卡系列刚修掉的空白 `FAIL=` 属同类问题：**自检在替失败打掩护**。本卡把"谁是元页面"从代码里的文件名清单，改为页面自己声明的标记，排除集合由扫描得出。

## 二、根因与设计

- 元页面 = 自证断言读取**上一轮** `regression-result.json` 的页面（run-all 在本页结束后才写 JSON，所以它们永远看到上一轮）。
- 用写死清单排除有三重缺陷：① 新增一张元页面就要回头改所有旧页面，漏改即产生一轮抖动；② 清单漂移后无人能一眼看出"哪些页被排除"；③ 排除规则散落在四个页面里，各自复制一份。
- 设计：页面 `<head>` 内 `<meta name="preflight-meta" content="1">` 声明身份；`run-all.ps1` 逐页读头部 20 行源码，命中标记即在结果行写 `meta=true`；验证页只消费 `row.meta`，不再保存任何文件名清单。
- 共用实现：`preflight/lib/meta.js`（UMD，Node 与浏览器共用一份），提供 `hasMarker / substantive / metaNames / excludeByName`。

## 三、改动

| 文件 | 改动 |
|---|---|
| `preflight/lib/meta.js` | 新增：标记常量、`hasMarker()`、`substantive(rows)`（去掉 `meta` 行）、`metaNames(rows)`、`excludeByName(names, markers)`（合成输入用纯函数） |
| `preflight/verify_d05/d06/d07/d08.html` | `<head>` 加标记；`<script src="lib/meta.js">`；排除实现由硬编码清单改为 `PreflightMeta.substantive(rows)` |
| `preflight/selfcheck/run-all.ps1` | 每页读头部 20 行，命中标记则行内写 `meta=true`；**裁决逻辑、汇总格式、BOM 均未动** |
| `preflight/verify_d09.html` | 新增 D9-1~D9-7（本页自身也带标记） |
| `preflight/selfcheck/d09-evidence.json` | 两轮真实回归记录 + 合成输入单测 + BOM |
| `规划-对标补齐.md` | §七 D-09、§八 50/50、§6.1 第 7 条 |

未改动：`Get-PageVerdict`、任何断言的判定强度（只改"排除谁"的来源）、`js/`、README/讲稿数字。

## 四、断言与证据

| 断言 | 判据 |
|---|---|
| D9-1 `markersPresent` | 四张元页面 XHR 读源码均含 `name="preflight-meta"`，并逐页给出命中行 |
| D9-2 `noHardcodedMetaLists` | 四页源码不含 `META = {`，且任一行不同时出现两个及以上元页面文件名 |
| D9-3 `syntheticExclusion` | 10 个合成页面名 + 4 个标记 → 排除恰为 4；再加 `verify_d09` 标记 → 自动变 5，旧页无需改动 |
| D9-4 `twoRoundsStable` | 两轮均 `TOTAL=50 PASS=50 FAIL=0 NONE=0 MIXED=0`、exit 0、50 行，且逐页裁决完全一致 |
| D9-5 `verdictUntouched` | `Get-PageVerdict` 函数体 FNV `d1f2c95f`、长度 785 |
| D9-6 `bomKept` | 首三字节 `239,187,191` |
| D9-7 `staticClean` | `selfcheck.js` 32 PASS / 1 WARN / 0 FAIL；上一轮回归 0 FAIL |

## 五、取舍与已知限制

1. **D9-4 的自举**：要证明"本页连续两轮通过"，记录里必然包含本页自身，存在循环依赖。因此 `d09-evidence.json` 仅在 `bootstrap=true` 且 `rounds` 为空时放行一次；**提交版本为 `bootstrap=false` 且含两轮真实记录**，严格分支要求两轮汇总均为 50/50、逐页裁决一致。自举只影响取证的第一步，不改变最终断言的强度。
2. **上一轮 JSON 的 `meta` 字段**：首轮读到的 JSON 由旧版 run-all 写出、没有 `meta` 字段，此时 `substantive()` 会当作全是实质页面。这正好等价于旧行为，不会造成误排除；从第二轮起字段齐全。
3. **没有真的新建临时页面**做可扩展性验证：`run-all` 按 `preflight/verify_*.html` 自动发现页面，临时页会进入回归集、改变页数、污染工作区与提交内容。改用 `excludeByName()` 的合成输入单测，同样是"改一个输入即验证"，且可重复。
4. **为什么不把扫描放进浏览器**：`file://` 下无法列目录；若在页面里逐个 XHR 50 个页面，会让每张元页面多 50 次同步请求。放在 run-all（它本来就在遍历页面）里扫描，是唯一既真实、又不拖慢回归的位置。
5. `META` 这个名字在 PowerShell/JS 两侧未复用同一常量（run-all 用正则、页面用 meta.js），因为 run-all 是 PowerShell 无法 require JS 文件；两侧以 D9-1 的标记存在性与 D9-3 的函数单测交叉校验。

## 六、不许动与回滚

- 不许动：`Get-PageVerdict`（FNV 必须仍为 `d1f2c95f`/785）、`run-all.ps1` 的裁决与汇总格式、任何断言的判定强度、`js/`、文档数字、`run-all.ps1` 的 UTF-8 BOM。
- 回滚：`git revert <commit>`；四张页面恢复硬编码排除清单，回归页数回到 49。
