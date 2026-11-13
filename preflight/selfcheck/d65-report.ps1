# preflight/selfcheck/d65-report.ps1 - D-65: B1/G2/S1/M1 batch on new growth curve
# usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File preflight\selfcheck\d65-report.ps1 -Runs 50 -Out d65-after.json
param(
  [int]$Runs = 50,
  [string]$Only = '',
  [int]$Adaptive = 1,
  [string]$Form = 'd50',
  [string]$Out = 'd65-after.json',
  [int]$MaxActions = 2500,
  [string]$Edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$page = Join-Path $root 'preflight\bot_d65.html'

$q = '?n=' + $Runs + '&adapt=' + $Adaptive + '&form=' + $Form
if ($Only -ne '') { $q = $q + '&only=' + $Only }
if ($MaxActions -ne 2500) { $q = $q + '&ma=' + $MaxActions }
$uri = ([System.Uri]$page).AbsoluteUri + $q
$tag = [guid]::NewGuid().ToString('N').Substring(0, 6)
$tmp = Join-Path $env:TEMP ('d65dom_' + $tag + '.html')
$ud = Join-Path $env:TEMP ('d65ud_' + $tag)

$eargs = @(
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--allow-file-access-from-files', '--hide-scrollbars', "--user-data-dir=$ud",
  '--window-size=1024,640', '--virtual-time-budget=1800000', '--dump-dom', $uri
)
Start-Process -FilePath $Edge -ArgumentList $eargs -NoNewWindow -Wait `
  -RedirectStandardOutput $tmp -RedirectStandardError ($tmp + '.err')

$dom = Get-Content -LiteralPath $tmp -Raw -Encoding UTF8
$mt = [regex]::Match($dom, '(?s)<pre id="report">(.*?)</pre>')
if (-not $mt.Success) { throw 'd65-report.ps1: no #report output (maybe BATCH_FAIL, see title)' }
$json = $mt.Groups[1].Value
$json = $json.Replace('&lt;', '<').Replace('&gt;', '>').Replace('&quot;', '"').Replace('&#39;', "'").Replace('&amp;', '&')
$obj = $json | ConvertFrom-Json
if (-not $obj.ok) { throw ('d65-report.ps1: batch failed: ' + $obj.err) }

$outPath = Join-Path $root ('preflight\selfcheck\' + $Out)
[System.IO.File]::WriteAllText($outPath, $json, (New-Object System.Text.UTF8Encoding($false)))

$rows = @()
foreach ($k in @('b1','g2','s1','m1')) {
  if ($obj.agg.$k) {
    $a = $obj.agg.$k
    $reach = @()
    foreach ($f in @('1','2','3','4','5')) { $reach += $f + ':' + $a.floorReach.$f }
    $rows += ($k + ' win=' + $a.wins + ' dead=' + $a.dead + ' stuck=' + $a.stuck +
      ' reach[' + ($reach -join ',') + '] cap=' + $a.cap2500 +
      ' avgSteps=' + $a.avgSteps + ' avgLv=' + $a.avgLevel + ' avgKills=' + $a.avgKills)
  }
}
Remove-Item $tmp, ($tmp + '.err'), $ud -Recurse -Force -ErrorAction SilentlyContinue
Write-Output ($rows -join "`n")
Write-Output ('-> ' + $outPath)
