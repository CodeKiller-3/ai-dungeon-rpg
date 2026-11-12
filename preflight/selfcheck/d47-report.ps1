# preflight/selfcheck/d47-report.ps1 - D-47: first physical NPC + quest loop
# usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File preflight\selfcheck\d47-report.ps1 -Out d47-after.json
# Same seeds 1001..1000+N and maxActions 2500 as D-37..D-46; never overwrites earlier artifacts.
param(
  [int]$Runs = 50,
  [string]$Only = '',
  [string]$Out = 'd47-after.json',
  [string]$Edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$page = Join-Path $root 'preflight\bot_d47.html'

$q = '?n=' + $Runs
if ($Only -ne '') { $q = $q + '&only=' + $Only }
$uri = ([System.Uri]$page).AbsoluteUri + $q
$tag = [guid]::NewGuid().ToString('N').Substring(0, 6)
$tmp = Join-Path $env:TEMP ('d47dom_' + $tag + '.html')
$ud = Join-Path $env:TEMP ('d47ud_' + $tag)

$eargs = @(
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--allow-file-access-from-files', '--hide-scrollbars', "--user-data-dir=$ud",
  '--window-size=1024,640', '--virtual-time-budget=1800000', '--dump-dom', $uri
)
Start-Process -FilePath $Edge -ArgumentList $eargs -NoNewWindow -Wait `
  -RedirectStandardOutput $tmp -RedirectStandardError ($tmp + '.err')

$dom = Get-Content -LiteralPath $tmp -Raw -Encoding UTF8
$mt = [regex]::Match($dom, '(?s)<pre id="report">(.*?)</pre>')
if (-not $mt.Success) { throw 'd47-report.ps1: no #report output (maybe BATCH_FAIL, see title)' }
$json = $mt.Groups[1].Value
$json = $json.Replace('&lt;', '<').Replace('&gt;', '>').Replace('&quot;', '"').Replace('&#39;', "'").Replace('&amp;', '&')

$obj = $json | ConvertFrom-Json
if (-not $obj.ok) { throw ('d47-report.ps1: batch failed: ' + $obj.err) }

$outPath = Join-Path $root ('preflight\selfcheck\' + $Out)
[System.IO.File]::WriteAllText($outPath, $json, (New-Object System.Text.UTF8Encoding($false)))

# evidence: git head at run time
$jsDiff = (git -C $root diff --stat -- js) -join "`n"
$head = (git -C $root rev-parse HEAD).Trim()
$g = [ordered]@{ diffStat = $jsDiff; head = $head; at = (Get-Date).ToString('s') }
$gj = $g | ConvertTo-Json -Depth 5
$gp = Join-Path $root 'preflight\selfcheck\d47-git.json'
[System.IO.File]::WriteAllText($gp, $gj, (New-Object System.Text.UTF8Encoding($false)))

Remove-Item $tmp, ($tmp + '.err'), $ud -Recurse -Force -ErrorAction SilentlyContinue

$b1w = $obj.agg.b1.outcomes.win
$b1f5 = $obj.agg.b1.f5.reached
$b1nw = '-'; if ($obj.agg.b1n) { $b1nw = $obj.agg.b1n.outcomes.win }
$g2f5 = '-'; if ($obj.agg.g2) { $g2f5 = $obj.agg.g2.f5.reached }
$s1f5 = '-'; if ($obj.agg.s1) { $s1f5 = $obj.agg.s1.f5.reached }
$m1f4 = '-'; if ($obj.agg.m1) { $m1f4 = $obj.agg.m1.floorReach.'4' }
Write-Output ('b1: wins=' + $b1w + ' f5=' + $b1f5 +
  ' | b1n: wins=' + $b1nw +
  ' accepted=' + $obj.npcAgg.accepted +
  ' delivered=' + $obj.npcAgg.delivered +
  ' npcGold=' + $obj.npcAgg.goldTotal +
  ' | g2_f5=' + $g2f5 + ' s1_f5=' + $s1f5 + ' m1_f4=' + $m1f4 + ' -> ' + $outPath)
