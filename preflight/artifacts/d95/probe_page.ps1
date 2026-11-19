# probe_page.ps1 - D-95 single page probe (diagnostics / negative evidence only)
# usage: powershell -ExecutionPolicy Bypass -File probe_page.ps1 -Page verify_d73 -N 1 -Tag neg1
param([string]$Page = 'verify_d73', [int]$N = 1, [int]$Budget = 3500, [string]$Tag = '')
$ErrorActionPreference = 'Continue'
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$outDir = $PSScriptRoot
$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
if ($Tag) { $stamp = $Tag } else { $stamp = (Get-Date -Format 'HHmmss') }
$url = ([System.Uri](Join-Path $root "preflight\$Page.html")).AbsoluteUri + '?run=d95'
for ($k = 1; $k -le $N; $k++) {
  $tag = [guid]::NewGuid().ToString('N').Substring(0, 8)
  $ud = Join-Path $env:TEMP ("edgedata_$tag")
  $o = Join-Path $env:TEMP ("sc_$tag.out")
  $e = Join-Path $env:TEMP ("sc_$tag.err")
  $shot = Join-Path $outDir ("d95-{0}-{1}.png" -f $stamp, $k)
  $sw = [Diagnostics.Stopwatch]::StartNew()
  Start-Process -FilePath $edge -ArgumentList @(
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--allow-file-access-from-files', "--user-data-dir=$ud",
    "--virtual-time-budget=$Budget", "--screenshot=$shot",
    '--window-size=1280,800', '--force-device-scale-factor=1', '--hide-scrollbars',
    '--dump-dom', $url
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
  }
  $f = Join-Path $outDir ("d95-{0}-{1}.log.txt" -f $stamp, $k)
  [IO.File]::WriteAllText($f, ("VERDICT={0}`r`n{1}`r`n`r`n{2}" -f $verdict, $payload, $dom), (New-Object System.Text.UTF8Encoding($false)))
  "{0} #{1} {2} {3}ms bytes={4} log={5}" -f $Page, $k, $verdict, $sw.ElapsedMilliseconds, $dom.Length, $f
  if ($verdict -ne 'PASS') {
    "PAYLOAD>>> " + $payload
  }
  Remove-Item -LiteralPath $ud -Recurse -Force -ErrorAction SilentlyContinue
}
