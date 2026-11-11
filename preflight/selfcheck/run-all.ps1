# preflight/selfcheck/run-all.ps1 — 全量回归批跑（Edge headless）
# 用法：powershell -ExecutionPolicy Bypass -File preflight/selfcheck/run-all.ps1 [-Budget 3000]
# 覆盖：preflight/verify_*.html 全部页面（含 verify_selfcheck 运行时自检、verify_smoke 主循环冒烟）
# 输出：逐页 PASS/FAIL 表 + preflight/selfcheck/regression-result.json；exit code = FAIL 页数

param([int]$Budget = 3500, [string[]]$VerdictFile = @(), [switch]$ShowSummary,
      [string]$ScanDir = '', [int]$ExpectPages = -1, [switch]$GuardProbe, [switch]$SelfTest)

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

# ── 产物指纹（D-15b）──────────────────────────────────────────
# 与 preflight/lib/meta.js 的 canonical()/fnv1a() 逐字节对齐：
#   page|verdict|meta|source|ms，行间 \n，无尾随换行；FNV-1a 32 位，输出小写 8 位十六进制。
# 规范化文本只含 ASCII（页面名、裁决、true/false、current-run、整数毫秒），
# 因此 JS 的 charCodeAt 与 PowerShell 的 UTF-8 字节等价。
function Get-RowsHash {
  param($Rows)
  $sb = New-Object System.Text.StringBuilder
  $first = $true
  foreach ($r in @($Rows)) {
    if (-not $first) { [void]$sb.Append("`n") }
    $first = $false
    $m = if ($r.meta) { 'true' } else { 'false' }
    $s = if ($r.source) { $r.source } else { '' }
    [void]$sb.Append("$($r.page)|$($r.verdict)|$m|$s|$($r.ms)")
  }
  $h = [uint32]2166136261
  foreach ($b in [Text.Encoding]::UTF8.GetBytes($sb.ToString())) {
    $h = $h -bxor [uint32]$b
    $h = [uint32](([uint64]$h * 16777619) % 4294967296)
  }
  return $h.ToString('x8')
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

# ── 页数兜底（D-22）──────────────────────────────────────────────
# 背景：本脚本按 glob 扫 verify_*.html，页数没有下限。若验证页被移走/改名，脚本会打印
#       TOTAL=0 PASS=0 FAIL=0 并以成功码退出——"一页没跑"看起来却是全绿。
# 做法：期望页面的**唯一来源**是仓库里的 preflight/selfcheck/page-baseline.json（人工维护的清单，
#       不参与本脚本运行期计算）。本轮实测清单与基线逐名比对：
#         少页 / 页数不等 → 失败（exit 2）
#         多页（新增未登记）→ 不失败，但打印 BASELINE_STALE 提示更新基线（因为"多跑"不会造成假绿，
#                            而"少跑"才会；仍不允许静默，必须有可见提示）
#       期望值绝不取 $rows / current-run.json / regression-result.json——那是本轮产物，自证会形成闭环。
$baselinePath = Join-Path $PSScriptRoot 'page-baseline.json'

function Get-PageGuard {
  param([string]$Dir, [int]$Expect = -1, [string[]]$BaselinePages = @())
  $files = @()
  if (Test-Path -LiteralPath $Dir) {
    $files = @(Get-ChildItem -LiteralPath $Dir -Filter 'verify_*.html' -ErrorAction SilentlyContinue |
      Sort-Object Name)
  }
  $actual = @($files | ForEach-Object { $_.BaseName })
  $expected = $Expect
  $source = 'param -ExpectPages'
  if ($expected -lt 0) {
    if ($BaselinePages.Count -gt 0) { $expected = @($BaselinePages).Count; $source = 'page-baseline.json' }
    else { $expected = -1; $source = 'MISSING' }
  }
  $missing = @()
  $extra = @()
  if ($BaselinePages.Count -gt 0) {
    $missing = @($BaselinePages | Where-Object { $actual -notcontains $_ })
    $extra = @($actual | Where-Object { $BaselinePages -notcontains $_ })
  }
  $empty = ($actual.Count -eq 0)
  # ok 判定：有页、期望值可用。
  #   -ExpectPages 显式给数时：实际页数必须严格等于它（多一页也算 FAIL，因为是人给的硬期望）；
  #   期望值来自基线时：只要求**基线的每一页都还在**（missing=0）；额外页不算失败，
  #   但会置 stale=true 并要求打印 BASELINE_STALE（多跑不会假绿，少跑才会；但不能静默）。
  $ok = (-not $empty) -and ($expected -ge 0)
  if ($ok) {
    if ($Expect -ge 0) { $ok = ($missing.Count -eq 0) -and ($actual.Count -eq $Expect) }
    else { $ok = ($missing.Count -eq 0) -and (($actual.Count - $extra.Count) -eq $expected) }
  }
  return [pscustomobject]@{
    expectSource = $source
    expected     = $expected
    actual       = $actual.Count
    missing      = $missing
    extra        = $extra
    empty        = $empty
    stale        = ($extra.Count -gt 0)
    ok           = $ok
  }
}

function Read-PageBaseline {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return @() }
  try {
    $j = Get-Content -LiteralPath $Path -Raw -Encoding utf8 | ConvertFrom-Json
    return @($j.pages)
  } catch { return @() }
}

$baselinePages = @(Read-PageBaseline -Path $baselinePath)
$scanDir = if ($ScanDir) { $ScanDir } else { Join-Path $root 'preflight' }

# ── 自测 / 探针（D-22）──────────────────────────────────────────
# 只跑"扫描 + 兜底判定"，不启动浏览器：用于 verify_d22 消费的负例证据，也用于人工排障。
# 与真实批跑互不干扰：-ScanDir 可指向临时目录，真实批跑路径不受影响。
if ($GuardProbe) {
  $g = Get-PageGuard -Dir $scanDir -Expect $ExpectPages -BaselinePages $baselinePages
  "GUARD=$(if ($g.ok) { 'OK' } else { 'FAIL' }) expected=$($g.expected) actual=$($g.actual) missing=$($g.missing.Count) extra=$($g.extra.Count) source=$($g.expectSource)"
  if ($g.empty) { "GUARD_EMPTY_SET=1" }
  if ($g.stale) { "BASELINE_STALE=1 extra=$($g.extra -join ',')" }
  if ($g.missing.Count -gt 0) { "GUARD_MISSING=$($g.missing -join ',')" }
  if (-not $g.ok) { exit 2 }
  exit 0
}

if ($SelfTest) {
  # 五个场景全部通过**子进程真实调用 -GuardProbe** 取证（拿到的就是真实退出码，不是本地推断）。
  # 临时目录里只放空 .html 占位，不复制也不改动项目里的任何验证页。
  $tmpRoot = Join-Path $env:TEMP ('d22selftest_' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Path $tmpRoot -Force | Out-Null
  $realDir = Join-Path $root 'preflight'
  $realCount = @(Get-ChildItem -LiteralPath $realDir -Filter 'verify_*.html').Count

  # 造两个临时扫描目录：一个"基线全在 + 多一页"，一个"缺一页"
  $dirExtra = Join-Path $tmpRoot 'extra'
  $dirShort = Join-Path $tmpRoot 'short'
  $dirEmpty = Join-Path $tmpRoot 'empty'
  New-Item -ItemType Directory -Path $dirExtra, $dirShort, $dirEmpty -Force | Out-Null
  foreach ($n in $baselinePages) {
    Set-Content -LiteralPath (Join-Path $dirExtra ($n + '.html')) -Value '' -Encoding ascii
  }
  Set-Content -LiteralPath (Join-Path $dirExtra 'verify_zz.html') -Value '' -Encoding ascii
  $shortList = @($baselinePages)
  if ($shortList.Count -gt 1) { $shortList = @($shortList[0..($shortList.Count - 2)]) }
  foreach ($n in $shortList) {
    Set-Content -LiteralPath (Join-Path $dirShort ($n + '.html')) -Value '' -Encoding ascii
  }

  $cases = @()
  $defs = @(
    @{ id = 'A_normal'; dir = $realDir; expect = -1; wantExit = 0; desc = '正常：真实目录，页数 = 基线' },
    @{ id = 'B_fewByExpect'; dir = $realDir; expect = ($realCount + 1); wantExit = 2; desc = '负例·少页：把期望页数调高 1' },
    @{ id = 'C_emptyDir'; dir = $dirEmpty; expect = -1; wantExit = 2; desc = '负例·空集：扫描目录为空' },
    @{ id = 'D_extraPage'; dir = $dirExtra; expect = -1; wantExit = 0; desc = '负例·多页：基线全在 + verify_zz' },
    @{ id = 'E_missingPage'; dir = $dirShort; expect = -1; wantExit = 2; desc = '负例·缺页：少一页' }
  )
  foreach ($d in $defs) {
    $args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-GuardProbe', '-ScanDir', $d.dir)
    if ($d.expect -ge 0) { $args += @('-ExpectPages', [string]$d.expect) }
    $o = Join-Path $tmpRoot ($d.id + '.out')
    $e = Join-Path $tmpRoot ($d.id + '.err')
    $p = Start-Process -FilePath 'powershell' -ArgumentList $args -NoNewWindow -Wait -PassThru `
      -RedirectStandardOutput $o -RedirectStandardError $e
    $txt = ''
    try { $txt = (Get-Content -LiteralPath $o -Raw -Encoding utf8) } catch { $txt = '' }
    $gl = ($txt -split "`r?`n" | Where-Object { $_ -match '^GUARD=' } | Select-Object -Last 1)
    $cases += [pscustomobject]@{
      id       = $d.id
      desc     = $d.desc
      scanDir  = $(if ($d.dir -eq $realDir) { '<preflight>' } else { '<temp>:' + (Split-Path $d.dir -Leaf) })
      expect   = $d.expect
      exit     = $p.ExitCode
      wantExit = $d.wantExit
      line     = $(if ($gl) { $gl } else { '' })
      emptySet = ($txt -match 'GUARD_EMPTY_SET=1')
      stale    = ($txt -match 'BASELINE_STALE=1')
      output   = ($txt -split "`r?`n" | Where-Object { $_ -match '^(GUARD|BASELINE_STALE)' }) -join ' | '
      ok       = ($p.ExitCode -eq $d.wantExit)
    }
  }
  # 额外用例：**主流程**空集（不只是探针）。在临时副本上跑真脚本，证明 TOTAL=0 不会以成功码退出。
  # 脚本与基线各复制一份到临时目录，$PSScriptRoot 随之落在临时目录，产物也写在那里，不碰项目文件。
  $copyDir = Join-Path $tmpRoot 'copy'
  New-Item -ItemType Directory -Path $copyDir -Force | Out-Null
  Copy-Item -LiteralPath $PSCommandPath -Destination (Join-Path $copyDir 'run-all.ps1') -Force
  Copy-Item -LiteralPath $baselinePath -Destination (Join-Path $copyDir 'page-baseline.json') -Force
  $fo = Join-Path $tmpRoot 'F_emptyMainFlow.out'
  $fe = Join-Path $tmpRoot 'F_emptyMainFlow.err'
  $fp = Start-Process -FilePath 'powershell' -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $copyDir 'run-all.ps1'),
    '-ScanDir', $dirEmpty, '-Budget', '300'
  ) -NoNewWindow -Wait -PassThru -RedirectStandardOutput $fo -RedirectStandardError $fe
  $ftxt = ''
  try { $ftxt = (Get-Content -LiteralPath $fo -Raw -Encoding utf8) } catch { $ftxt = '' }
  $cases += [pscustomobject]@{
    id       = 'F_emptyMainFlow'
    desc     = '负例·空集（主流程）：副本脚本跑空目录，TOTAL=0 必须以非 0 退出'
    scanDir  = '<tempcopy>:empty'
    expect   = -1
    exit     = $fp.ExitCode
    wantExit = 2
    line     = $(@($ftxt -split "`r?`n" | Where-Object { $_ -match '^GUARD=' }) -join '')
    emptySet = ($ftxt -match 'GUARD_EMPTY_SET=1')
    stale    = ($ftxt -match 'BASELINE_STALE=1')
    output   = (@($ftxt -split "`r?`n" | Where-Object { $_ -match '^(TOTAL|GUARD|GUARD_EXIT)' }) -join ' | ')
    ok       = ($fp.ExitCode -eq 2) -and ($ftxt -match 'TOTAL=0 ') -and ($ftxt -match 'GUARD_EXIT=EMPTY')
  }
  Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue

  # 脚本指纹：整份脚本的 UTF-8 字节（BOM 除外）FNV-1a——验证页据此拒收过期自测产物
  $bytes = [IO.File]::ReadAllBytes($PSCommandPath)
  $off = if ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) { 3 } else { 0 }
  $h = [uint32]2166136261
  for ($i = $off; $i -lt $bytes.Length; $i++) {
    $h = $h -bxor [uint32]$bytes[$i]
    $h = [uint32](([uint64]$h * 16777619) % 4294967296)
  }
  # 文本指纹：按 UTF-16 码元（PowerShell char / JS charCodeAt 同值）算一遍。
  # 页面侧只能拿到 responseText（浏览器会吃掉 BOM、且 file:// 下 arraybuffer 不可靠），
  # 用文本指纹比对才能证明「这份自测产物对应现在磁盘上的脚本」。
  $text = [IO.File]::ReadAllText($PSCommandPath, [Text.Encoding]::UTF8)
  $th = [uint32]2166136261
  foreach ($ch in $text.ToCharArray()) {
    $th = $th -bxor [uint32][int]$ch
    $th = [uint32](([uint64]$th * 16777619) % 4294967296)
  }
  $allOk = (@($cases | Where-Object { -not $_.ok }).Count -eq 0)
  $res = [pscustomobject]@{
    at            = (Get-Date).ToString('s')
    scriptFnv     = $h.ToString('x8')
    scriptLen     = $bytes.Length
    scriptTextFnv = $th.ToString('x8')
    scriptTextLen = $text.Length
    bomBytes      = $(if ($off -eq 3) { '239,187,191' } else { (@($bytes[0..2]) -join ',') })
    baselinePath  = 'page-baseline.json'
    baselineCount = @($baselinePages).Count
    allAsExpected = $allOk
    cases         = $cases
  }
  $outPath = Join-Path $PSScriptRoot 'd22-selftest.json'
  [IO.File]::WriteAllText($outPath, ($res | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
  foreach ($c in $cases) {
    "{0,-16} exit={1} want={2} {3}  {4}" -f $c.id, $c.exit, $c.wantExit, $(if ($c.ok) { 'OK  ' } else { 'BAD ' }), $c.output
  }
  "SELFTEST=$outPath ALL_AS_EXPECTED=$allOk"
  if ($allOk) { exit 0 } else { exit 1 }
}

$targets = @(Get-ChildItem -LiteralPath $scanDir -Filter 'verify_*.html' -ErrorAction SilentlyContinue | Sort-Object Name)
$rows = @()
$fail = 0

# ── 本轮身份证与台账（D-15b）──────────────────────────────────
# 每条结果行都带 runId / source=current-run；每页结束即把截至当前的行写入 current-run.json。
# 页面以 ?run=<runId> 打开，读 JSON 时把 runId 不等的行标为 previous-run——"这行哪来的"可被机器读出。
# 最终 regression-result.json 额外写 rowsHash（FNV-1a over 规范化行文本），页面可复算；
# 任何手工改行的行为都会让哈希不匹配，自举不再需要人工介入。
$runId = (Get-Date).ToString('yyyyMMddHHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 6)
$startedAt = (Get-Date).ToString('s')
$ledgerPath = Join-Path $PSScriptRoot 'current-run.json'
@{ runId = $runId; startedAt = $startedAt; rows = @() } |
  ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ledgerPath -Encoding utf8

foreach ($t in $targets) {
  $url = ([System.Uri]$t.FullName).AbsoluteUri + '?run=' + $runId
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
    source  = 'current-run'
    ms      = [int]$sw.ElapsedMilliseconds
    payload = if ($payload.Length -gt 220) { $payload.Substring(0, 220) + '…' } else { $payload }
  }
  # 本轮台账：后续页面（按文件名排在后面的元页面）读到的就是本轮已完成页的真实裁决，
  # 不再需要"读上一轮 → 被上一轮的失败拖一轮"。
  @{ runId = $runId; startedAt = $startedAt; rows = $rows } |
    ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ledgerPath -Encoding utf8
  Remove-Item -LiteralPath $o, $e -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $ud -Recurse -Force -ErrorAction SilentlyContinue
}

$rows | Format-Table -AutoSize -Wrap | Out-String -Width 260
# 取值变量必须写作 $summary（D6-6/D8-4 按此模板字符串比对）；因此本脚本的开关参数不能用
# [switch]$Summary —— PowerShell 变量名不分大小写，会与 $summary 撞名，赋值时触发
# SwitchParameter 类型转换异常、汇总行整行空白（D-08 实测）。开关统一叫 -ShowSummary。
$summary = Get-RegressionSummary -Rows $rows
"TOTAL=$($summary.total) PASS=$($summary.pass) FAIL=$($summary.fail) NONE=$($summary.none) MIXED=$($summary.mixed)"

# ── 页数兜底（D-22）──────────────────────────────────────────────
# 期望值只来自 page-baseline.json（人工维护），绝不从本轮 $rows / current-run.json 反推。
# 少页（或显式期望不符 / 空集）→ exit 2；多页 → 仅 BASELINE_STALE 提示，退出码仍按 $fail。
$guard = Get-PageGuard -Dir $scanDir -Expect $ExpectPages -BaselinePages $baselinePages
"GUARD=$(if ($guard.ok) { 'OK' } else { 'FAIL' }) expected=$($guard.expected) actual=$($guard.actual) missing=$($guard.missing.Count) extra=$($guard.extra.Count) source=$($guard.expectSource)"
if ($guard.empty) { "GUARD_EMPTY_SET=1" }
if ($guard.stale) { "BASELINE_STALE=1 extra=$($guard.extra -join ',')  → page-baseline.json 需更新（新增页未登记）" }
if ($guard.missing.Count -gt 0) { "GUARD_MISSING=$($guard.missing -join ',')" }

$jsonPath = Join-Path $PSScriptRoot 'regression-result.json'
$rowsHash = Get-RowsHash -Rows $rows
@{ runId = $runId; startedAt = $startedAt; summary = $summary; rowsHash = $rowsHash; guard = $guard; rows = $rows } |
  ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $jsonPath -Encoding utf8
"RESULT_JSON=$jsonPath"
if (@($rows).Count -eq 0) { "GUARD_EXIT=EMPTY"; exit 2 }
if (-not $guard.ok) { "GUARD_EXIT=FAIL"; exit 2 }
exit $fail
