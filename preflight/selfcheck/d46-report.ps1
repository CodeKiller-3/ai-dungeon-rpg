# preflight/selfcheck/d46-report.ps1 - D-46: early gold channel
# usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File preflight\selfcheck\d46-report.ps1 -Out d46-after.json
#   powershell -NoProfile -ExecutionPolicy Bypass -File preflight\selfcheck\d46-report.ps1 -Mode neg -Out d46-neg.json
# Same seeds 1001..1000+N and maxActions 2500 as D-44/D-45; never overwrites D-37..D-45 artifacts.
param(
  [int]$Runs = 50,
  [string]$Mode = '',
  [string]$Only = '',
  [string]$Out = 'd46-after.json',
  [string]$Edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$page = Join-Path $root 'preflight\bot_d46.html'

$q = '?n=' + $Runs
if ($Mode -ne '') { $q = $q + '&mode=' + $Mode }
if ($Only -ne '') { $q = $q + '&only=' + $Only }
$uri = ([System.Uri]$page).AbsoluteUri + $q
$tag = [guid]::NewGuid().ToString('N').Substring(0, 6)
$tmp = Join-Path $env:TEMP ('d46dom_' + $tag + '.html')
$ud = Join-Path $env:TEMP ('d46ud_' + $tag)

$eargs = @(
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--allow-file-access-from-files', '--hide-scrollbars', "--user-data-dir=$ud",
  '--window-size=1024,640', '--virtual-time-budget=1800000', '--dump-dom', $uri
)
Start-Process -FilePath $Edge -ArgumentList $eargs -NoNewWindow -Wait `
  -RedirectStandardOutput $tmp -RedirectStandardError ($tmp + '.err')

$dom = Get-Content -LiteralPath $tmp -Raw -Encoding UTF8
$mt = [regex]::Match($dom, '(?s)<pre id="report">(.*?)</pre>')
if (-not $mt.Success) { throw 'd46-report.ps1: no #report output (maybe BATCH_FAIL, see title)' }
$json = $mt.Groups[1].Value
$json = $json.Replace('&lt;', '<').Replace('&gt;', '>').Replace('&quot;', '"').Replace('&#39;', "'").Replace('&amp;', '&')

$obj = $json | ConvertFrom-Json
if (-not $obj.ok) { throw ('d46-report.ps1: batch failed: ' + $obj.err) }

$outPath = Join-Path $root ('preflight\selfcheck\' + $Out)
[System.IO.File]::WriteAllText($outPath, $json, (New-Object System.Text.UTF8Encoding($false)))

# evidence: js diff snapshot at run time
if ($Mode -eq '') {
  $jsDiff = (git -C $root diff --stat -- js) -join "`n"
  $head = (git -C $root rev-parse HEAD).Trim()
  $g = [ordered]@{ diffStat = $jsDiff; head = $head; at = (Get-Date).ToString('s') }
  $gj = $g | ConvertTo-Json -Depth 5
  $gp = Join-Path $root 'preflight\selfcheck\d46-git.json'
  [System.IO.File]::WriteAllText($gp, $gj, (New-Object System.Text.UTF8Encoding($false)))
}

Remove-Item $tmp, ($tmp + '.err'), $ud -Recurse -Force -ErrorAction SilentlyContinue

if ($Mode -eq 'neg') {
  Write-Output ('neg: wins=' + $obj.neg.agg.outcomes.win + '/' + $Runs +
    ' f5=' + $obj.neg.agg.f5.reached +
    ' dragonKills=' + $obj.neg.b1.dragon.kills +
    ' rewardPicks=' + $obj.neg.d46.reward.picks +
    ' -> ' + $outPath)
  return
}

$b = $obj.agg.b1
$g2f5 = '-'; if ($obj.agg.g2) { $g2f5 = $obj.agg.g2.f5.reached }
$s1f5 = '-'; if ($obj.agg.s1) { $s1f5 = $obj.agg.s1.f5.reached }
$m1f4 = '-'; if ($obj.agg.m1) { $m1f4 = $obj.agg.m1.floorReach.'4' }
Write-Output ('b1: wins=' + $b.outcomes.win + ' f5=' + $b.f5.reached +
  ' dragonKills=' + $obj.b1.dragon.kills + '/' + $obj.b1.dragon.attempts +
  ' equipBuys=' + $obj.d45.equipBuys +
  ' rewardPicks=' + $obj.d46.reward.picks +
  ' balanceMaxAbs=' + $obj.d46.balanceMaxAbs +
  ' f1gapMed=' + $obj.d46.gaps.f1.median +
  ' f2gapMed=' + $obj.d46.gaps.f2.median +
  ' | g2_f5=' + $g2f5 + ' s1_f5=' + $s1f5 + ' m1_f4=' + $m1f4 + ' -> ' + $outPath)
