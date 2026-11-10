# preflight/selfcheck/run-all.ps1 — 全量回归批跑（Edge headless）
# 用法：powershell -ExecutionPolicy Bypass -File preflight/selfcheck/run-all.ps1 [-Budget 3000]
# 覆盖：preflight/verify_*.html 全部页面（含 verify_selfcheck 运行时自检、verify_smoke 主循环冒烟）
# 输出：逐页 PASS/FAIL 表 + preflight/selfcheck/regression-result.json；exit code = FAIL 页数

param([int]$Budget = 3500, [string[]]$VerdictFile = @(), [switch]$ShowSummary)

# ── 裁决解析（D-06）──────────────────────────────────────────────
# 逐页裁决只认页面输出中的**独立裁决行**：行首（允许带 HTML 标签前缀）为 "PASS {json}" / "FAIL {json}"。
# 同一页出现多条时取**最后一条**；只有同时出现 PASS 与 FAIL 两条裁决行（页面自相矛盾）才判 MIXED；
# 一条都没有判 NONE。**不扫描 payload 内部字段**——payload 里合法的 "ok":false 是数据，不是裁决。
function Get-PageVerdict {
  param([string]$Text)
  $hits = @()
  foreach ($line in ($Text -split "`r?`n")) {
    $s = $line -replace '^(?:<[^>]*>)+', ''
    $m = [regex]::Match($s, '^\s*(PASS|FAIL)\s+\{')
    if ($m.Success) { $hits += [pscustomobject]@{ verdict = $m.Groups[1].Value; line = $s } }
  }
  if ($hits.Count -eq 0) { return [pscustomobject]@{ verdict = 'NONE'; payload = '' } }
  $last = $hits[$hits.Count - 1]
  $names = @($hits | ForEach-Object { $_.verdict })
  $verdict = if (($names -contains 'PASS') -and ($names -contains 'FAIL')) { 'MIXED' } else { $last.verdict }
  $pm = [regex]::Match($last.line, '^(?:PASS|FAIL)\s+(\{[\s\S]*?\})\s*(?:</|$)')
  return [pscustomobject]@{ verdict = $verdict; payload = $(if ($pm.Success) { $pm.Groups[1].Value } else { '' }) }
}

# ── 汇总计数（D-08）──────────────────────────────────────────────
# PowerShell 中 `(... | Where-Object {...}).Count` 在结果恰好 1 条时拿到的是单个对象，
# .Count 取不到值 → 打印为空白（"一页失败"看起来像"零失败"）。所有计数一律用 @(...) 强制数组。
function Get-RegressionSummary {
  param($Rows)
  [pscustomobject]@{
    at    = (Get-Date).ToString('s')
    total = @($Rows).Count
    pass  = @($Rows | Where-Object { $_.verdict -eq 'PASS' }).Count
    fail  = @($Rows | Where-Object { $_.verdict -eq 'FAIL' }).Count
    none  = @($Rows | Where-Object { $_.verdict -eq 'NONE' }).Count
    mixed = @($Rows | Where-Object { $_.verdict -eq 'MIXED' }).Count
  }
}

# D6-1/D6-2/D6-3 用：对给定文本文件跑一次裁决解析（不启动浏览器），输出裁决行供取证
# D8-1~D8-3 用：加 -ShowSummary 时按同一套汇总函数打印汇总行并以 FAIL 数退出，用于单条场景取证
if ($VerdictFile.Count -gt 0) {
  $vrRows = @()
  foreach ($vf in $VerdictFile) {
    $txt = Get-Content -LiteralPath $vf -Raw -Encoding utf8
    $r = Get-PageVerdict -Text $txt
    $vrRows += [pscustomobject]@{ page = [IO.Path]::GetFileNameWithoutExtension($vf); verdict = $r.verdict; payload = $r.payload }
  }
  if ($ShowSummary) {
    $s = Get-RegressionSummary -Rows $vrRows
    "TOTAL=$($s.total) PASS=$($s.pass) FAIL=$($s.fail) NONE=$($s.none) MIXED=$($s.mixed)"
    exit $s.fail
  }
  "VERDICT=$($vrRows[$vrRows.Count - 1].verdict)"
  exit 0
}

$ErrorActionPreference = 'Continue'
$env:PATH = "C:\Windows\System32;C:\Windows;$env:PATH"

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
if (-not (Test-Path -LiteralPath $edge)) { Write-Output "EDGE_NOT_FOUND"; exit 99 }

$targets = @(Get-ChildItem -LiteralPath (Join-Path $root 'preflight') -Filter 'verify_*.html' | Sort-Object Name)
$rows = @()
$fail = 0

foreach ($t in $targets) {
  $url = ([System.Uri]$t.FullName).AbsoluteUri
  $tag = [guid]::NewGuid().ToString('N').Substring(0, 8)
  $ud = Join-Path $env:TEMP ("edgedata_$tag")
  $o  = Join-Path $env:TEMP ("sc_$tag.out")
  $e  = Join-Path $env:TEMP ("sc_$tag.err")
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $p = Start-Process -FilePath $edge -ArgumentList @(
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--allow-file-access-from-files', "--user-data-dir=$ud",
    "--virtual-time-budget=$Budget", '--dump-dom', $url
  ) -NoNewWindow -Wait -PassThru -RedirectStandardOutput $o -RedirectStandardError $e
  $sw.Stop()

  $dom = ''
  try { $dom = Get-Content -LiteralPath $o -Raw -Encoding utf8 } catch { $dom = '' }
  $r = Get-PageVerdict -Text $dom
  $verdict = $r.verdict
  $payload = $r.payload
  if ($verdict -eq 'FAIL' -or $verdict -eq 'NONE') { $fail++ }

  # ── 元页面身份（D-09）──────────────────────────────────────────
  # 页面 <head> 内的 <meta name="preflight-meta" content="1"> 表示：该页的自证断言
  # 读取上一轮回归结果，因此不参与其它元页面的自证集合。这里扫 preflight/ 下每个
  # 页面的头部源码得出身份，写入行内 meta 字段；验证页只消费该字段，不再维护文件名清单。
  $head = @(Get-Content -LiteralPath $t.FullName -TotalCount 20 -Encoding utf8)
  $isMeta = (($head -join "`n") -match 'name="preflight-meta"')

  $rows += [pscustomobject]@{
    page    = $t.BaseName
    verdict = $verdict
    meta    = $isMeta
    ms      = [int]$sw.ElapsedMilliseconds
    payload = if ($payload.Length -gt 220) { $payload.Substring(0, 220) + '…' } else { $payload }
  }
  Remove-Item -LiteralPath $o, $e -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $ud -Recurse -Force -ErrorAction SilentlyContinue
}

$rows | Format-Table -AutoSize -Wrap | Out-String -Width 260
# 取值变量必须写作 $summary（D6-6/D8-4 按此模板字符串比对）；因此本脚本的开关参数不能用
# [switch]$Summary —— PowerShell 变量名不分大小写，会与 $summary 撞名，赋值时触发
# SwitchParameter 类型转换异常、汇总行整行空白（D-08 实测）。开关统一叫 -ShowSummary。
$summary = Get-RegressionSummary -Rows $rows
"TOTAL=$($summary.total) PASS=$($summary.pass) FAIL=$($summary.fail) NONE=$($summary.none) MIXED=$($summary.mixed)"
$jsonPath = Join-Path $PSScriptRoot 'regression-result.json'
@{ summary = $summary; rows = $rows } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $jsonPath -Encoding utf8
"RESULT_JSON=$jsonPath"
exit $fail
