# preflight/selfcheck/d45-report.ps1 - D-45: equipment economy audit
# usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File preflight\selfcheck\d45-report.ps1 -Out d45-after.json
#   powershell -NoProfile -ExecutionPolicy Bypass -File preflight\selfcheck\d45-report.ps1 -Mode tiers -Seed 1042 -Out d45-tiers.json
#   powershell -NoProfile -ExecutionPolicy Bypass -File preflight\selfcheck\d45-report.ps1 -Mode neg -Out d45-neg.json
# Same seeds 1001..1000+N and maxActions 2500 as D-44; never overwrites D-37..D-44 artifacts.
param(
  [int]$Runs = 50,
  [string]$Mode = '',
  [string]$Only = '',
  [int]$Seed = 1042,
  [switch]$From1,
  [string]$Weapon = 'sword_dragon_epic',
  [string]$Out = 'd45-after.json',
  [string]$Edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$page = Join-Path $root 'preflight\bot_d45.html'

$q = '?n=' + $Runs
if ($Mode -ne '') { $q = $q + '&mode=' + $Mode }
if ($Only -ne '') { $q = $q + '&only=' + $Only }
if ($Mode -eq 'tiers') { $q = $q + '&seed=' + $Seed }
if ($Mode -eq 'ceiling') { $q = $q + '&weapon=' + $Weapon }
if ($Mode -eq 'ceiling' -and $From1) { $q = $q + '&from1=1' }
$uri = ([System.Uri]$page).AbsoluteUri + $q
$tag = [guid]::NewGuid().ToString('N').Substring(0, 6)
$tmp = Join-Path $env:TEMP ('d45dom_' + $tag + '.html')
$ud = Join-Path $env:TEMP ('d45ud_' + $tag)

$eargs = @(
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--allow-file-access-from-files', '--hide-scrollbars', "--user-data-dir=$ud",
  '--window-size=1024,640', '--virtual-time-budget=1800000', '--dump-dom', $uri
)
Start-Process -FilePath $Edge -ArgumentList $eargs -NoNewWindow -Wait `
  -RedirectStandardOutput $tmp -RedirectStandardError ($tmp + '.err')

$dom = Get-Content -LiteralPath $tmp -Raw -Encoding UTF8
$mt = [regex]::Match($dom, '(?s)<pre id="report">(.*?)</pre>')
if (-not $mt.Success) { throw 'd45-report.ps1: no #report output (maybe BATCH_FAIL, see title)' }
$json = $mt.Groups[1].Value
$json = $json.Replace('&lt;', '<').Replace('&gt;', '>').Replace('&quot;', '"').Replace('&#39;', "'").Replace('&amp;', '&')

$obj = $json | ConvertFrom-Json
if (-not $obj.ok) { throw ('d45-report.ps1: batch failed: ' + $obj.err) }

$outPath = Join-Path $root ('preflight\selfcheck\' + $Out)
[System.IO.File]::WriteAllText($outPath, $json, (New-Object System.Text.UTF8Encoding($false)))

# F group evidence: item table / supply tables snapshot for the run
if ($Mode -eq '') {
  $jsDiff = (git -C $root diff --stat -- js) -join "`n"
  $head = (git -C $root rev-parse HEAD).Trim()
  $g = [ordered]@{ diffStat = $jsDiff; head = $head; at = (Get-Date).ToString('s') }
  $gj = $g | ConvertTo-Json -Depth 5
  $gp = Join-Path $root 'preflight\selfcheck\d45-git.json'
  [System.IO.File]::WriteAllText($gp, $gj, (New-Object System.Text.UTF8Encoding($false)))
}

Remove-Item $tmp, ($tmp + '.err'), $ud -Recurse -Force -ErrorAction SilentlyContinue

if ($Mode -eq 'neg') {
  Write-Output ('neg: wins=' + $obj.neg.agg.outcomes.win + '/' + $Runs +
    ' f5=' + $obj.neg.agg.f5.reached +
    ' dragonKills=' + $obj.neg.b1.dragon.kills + ' -> ' + $outPath)
  return
}
if ($Mode -eq 'tiers') {
  $n = 0
  if ($obj.tiers.rows) { $n = @($obj.tiers.rows).Count }
  Write-Output ('tiers: seed=' + $obj.tiers.seed + ' rows=' + $n + ' -> ' + $outPath)
  return
}
if ($Mode -eq 'ceiling') {
  Write-Output ('ceiling: weapon=' + $obj.ceiling.weapon +
    ' wins=' + $obj.ceiling.agg.outcomes.win + '/' + $Runs +
    ' f5=' + $obj.ceiling.agg.f5.reached +
    ' dragonKills=' + $obj.ceiling.b1.dragon.kills + '/' + $obj.ceiling.b1.dragon.attempts +
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
  ' noStock=' + $obj.d45.counts.noStock +
  ' goldShort=' + $obj.d45.counts.goldShort +
  ' noEntry=' + $obj.d45.counts.noEntry +
  ' priority=' + $obj.d45.counts.priority +
  ' | g2_f5=' + $g2f5 + ' s1_f5=' + $s1f5 + ' m1_f4=' + $m1f4 + ' -> ' + $outPath)
