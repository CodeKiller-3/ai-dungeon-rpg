# probe_page.ps1 — 单页重复复跑（诊断用，不参与回归）
# 用法: powershell -ExecutionPolicy Bypass -File probe_page.ps1 -Page verify_d89 -N 6
param([string]$Page = 'verify_d89', [int]$N = 6, [int]$Budget = 3500)
$ErrorActionPreference = 'Continue'
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$root = 'd:\桌面\工作\人工智能大作业'
$outDir = Join-Path $root 'preflight\artifacts\d94'
$url = ([System.Uri](Join-Path $root "preflight\$Page.html")).AbsoluteUri + '?run=p6probe'
for ($k = 1; $k -le $N; $k++) {
  $tag = [guid]::NewGuid().ToString('N').Substring(0, 8)
  $ud = Join-Path $env:TEMP ("edgedata_$tag")
  $o = Join-Path $env:TEMP ("sc_$tag.out")
  $e = Join-Path $env:TEMP ("sc_$tag.err")
  $sw = [Diagnostics.Stopwatch]::StartNew()
  Start-Process -FilePath $edge -ArgumentList @(
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--allow-file-access-from-files', "--user-data-dir=$ud",
    "--virtual-time-budget=$Budget", '--dump-dom', $url
  ) -NoNewWindow -Wait -RedirectStandardOutput $o -RedirectStandardError $e | Out-Null
  $sw.Stop()
  $dom = ''
  try { $dom = Get-Content -LiteralPath $o -Raw -Encoding utf8 } catch { $dom = '' }
  $line = @($dom -split "`r?`n" | Where-Object { $_ -match '<pre id="result">(PASS|FAIL)' } | Select-Object -Last 1)
  $verdict = 'NONE'; $payload = ''
  if ($line.Count -gt 0) {
    $s = ($line[0] -replace '.*<pre id="result">', '') -replace '</pre>.*', ''
    $verdict = $s.Substring(0, 4).Trim()
    $payload = $s.Substring(4).Trim()
    $f = Join-Path $outDir ("probe-{0}-{1}.txt" -f $Page, $k)
    [IO.File]::WriteAllText($f, $dom, (New-Object System.Text.UTF8Encoding($false)))
  }
  "{0} #{1} {2} {3}ms bytes={4}" -f $Page, $k, $verdict, $sw.ElapsedMilliseconds, $dom.Length
  if ($verdict -ne 'PASS') {
    "PAYLOAD>>> " + $payload
  }
  Remove-Item -LiteralPath $ud -Recurse -Force -ErrorAction SilentlyContinue
}
