# preflight/selfcheck/d58-report.ps1 - D-58: monster habits + chest placement batch (numbers unchanged)
# usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File preflight\selfcheck\d58-report.ps1 -Runs 50 -Out d58-after.json
param(
  [int]$Runs = 50,
  [string]$Only = '',
  [int]$Adaptive = 1,
  [string]$Form = 'd50',
  [string]$Out = 'd58-after.json',
  [string]$Edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$page = Join-Path $root 'preflight\bot_d58.html'

$q = '?n=' + $Runs + '&adapt=' + $Adaptive + '&form=' + $Form
if ($Only -ne '') { $q = $q + '&only=' + $Only }
$uri = ([System.Uri]$page).AbsoluteUri + $q
$tag = [guid]::NewGuid().ToString('N').Substring(0, 6)
$tmp = Join-Path $env:TEMP ('d58dom_' + $tag + '.html')
$ud = Join-Path $env:TEMP ('d58ud_' + $tag)

$eargs = @(
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--allow-file-access-from-files', '--hide-scrollbars', "--user-data-dir=$ud",
  '--window-size=1024,640', '--virtual-time-budget=1800000', '--dump-dom', $uri
)
Start-Process -FilePath $Edge -ArgumentList $eargs -NoNewWindow -Wait `
  -RedirectStandardOutput $tmp -RedirectStandardError ($tmp + '.err')

$dom = Get-Content -LiteralPath $tmp -Raw -Encoding UTF8
$mt = [regex]::Match($dom, '(?s)<pre id="report">(.*?)</pre>')
if (-not $mt.Success) { throw 'd58-report.ps1: no #report output (maybe BATCH_FAIL, see title)' }
$json = $mt.Groups[1].Value
$json = $json.Replace('&lt;', '<').Replace('&gt;', '>').Replace('&quot;', '"').Replace('&#39;', "'").Replace('&amp;', '&')

$obj = $json | ConvertFrom-Json
if (-not $obj.ok) { throw ('d58-report.ps1: batch failed: ' + $obj.err) }

$outPath = Join-Path $root ('preflight\selfcheck\' + $Out)
[System.IO.File]::WriteAllText($outPath, $json, (New-Object System.Text.UTF8Encoding($false)))

$jsDiff = (git -C $root diff --stat -- js) -join "`n"
$head = (git -C $root rev-parse HEAD).Trim()
$g = [ordered]@{ diffStat = $jsDiff; head = $head; at = (Get-Date).ToString('s'); adaptive = $Adaptive; form = $Form }
$gj = $g | ConvertTo-Json -Depth 5
$gp = Join-Path $root 'preflight\selfcheck\d58-git.json'
[System.IO.File]::WriteAllText($gp, $gj, (New-Object System.Text.UTF8Encoding($false)))

Remove-Item $tmp, ($tmp + '.err'), $ud -Recurse -Force -ErrorAction SilentlyContinue

$b1w = $obj.agg.b1.outcomes.win
$b1f5 = $obj.agg.b1.f5.reached
$rs = $obj.agg.b1.rescue
$g2f5 = '-'; if ($obj.agg.g2) { $g2f5 = $obj.agg.g2.f5.reached }
$s1f5 = '-'; if ($obj.agg.s1) { $s1f5 = $obj.agg.s1.f5.reached }
$m1f4 = '-'; if ($obj.agg.m1) { $m1f4 = $obj.agg.m1.floorReach.'4' }
Write-Output ('adapt=' + $Adaptive + ' form=' + $Form + ' b1: wins=' + $b1w + ' f5=' + $b1f5 +
  ' rescue_runs=' + $rs.runs + ' triggers=' + $rs.triggers + ' gear=' + $rs.gear +
  ' spent=' + $rs.spent + ' maxTrigger=' + $rs.maxTriggers + ' maxSpent=' + $rs.maxSpent +
  ' | g2_f5=' + $g2f5 + ' s1_f5=' + $s1f5 + ' m1_f4=' + $m1f4 + ' -> ' + $outPath)
