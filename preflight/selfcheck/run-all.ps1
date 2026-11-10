# preflight/selfcheck/run-all.ps1 — 全量回归批跑（Edge headless）
# 用法：powershell -ExecutionPolicy Bypass -File preflight/selfcheck/run-all.ps1 [-Budget 3000]
# 覆盖：preflight/verify_*.html 全部页面（含 verify_selfcheck 运行时自检、verify_smoke 主循环冒烟）
# 输出：逐页 PASS/FAIL 表 + preflight/selfcheck/regression-result.json；exit code = FAIL 页数

param([int]$Budget = 3500, [string]$VerdictFile = '')

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

# D6-1/D6-2/D6-3 用：对给定文本文件跑一次裁决解析（不启动浏览器），输出裁决行供取证
if ($VerdictFile) {
  $txt = Get-Content -LiteralPath $VerdictFile -Raw -Encoding utf8
  "VERDICT=$((Get-PageVerdict -Text $txt).verdict)"
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

  $rows += [pscustomobject]@{
    page    = $t.BaseName
    verdict = $verdict
    ms      = [int]$sw.ElapsedMilliseconds
    payload = if ($payload.Length -gt 220) { $payload.Substring(0, 220) + '…' } else { $payload }
  }
  Remove-Item -LiteralPath $o, $e -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $ud -Recurse -Force -ErrorAction SilentlyContinue
}

$rows | Format-Table -AutoSize -Wrap | Out-String -Width 260
$summary = [pscustomobject]@{
  at      = (Get-Date).ToString('s')
  total   = $rows.Count
  pass    = ($rows | Where-Object { $_.verdict -eq 'PASS' }).Count
  fail    = ($rows | Where-Object { $_.verdict -eq 'FAIL' }).Count
  none    = ($rows | Where-Object { $_.verdict -eq 'NONE' }).Count
  mixed   = ($rows | Where-Object { $_.verdict -eq 'MIXED' }).Count
}
"TOTAL=$($summary.total) PASS=$($summary.pass) FAIL=$($summary.fail) NONE=$($summary.none) MIXED=$($summary.mixed)"
$jsonPath = Join-Path $PSScriptRoot 'regression-result.json'
@{ summary = $summary; rows = $rows } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $jsonPath -Encoding utf8
"RESULT_JSON=$jsonPath"
exit $fail
