# preflight/selfcheck/d67-report.ps1 - D-67: B1 encounter-cost attribution + four strategies + boss rounds
# usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File preflight\selfcheck\d67-report.ps1 -Runs 50 -Out d67-2500.json -MaxActions 2500
#   powershell -NoProfile -ExecutionPolicy Bypass -File preflight\selfcheck\d67-report.ps1 -Only b1 -Out d67-base-b1.json
param(
  [int]$Runs = 50,
  [string]$Only = '',
  [int]$Adaptive = 1,
  [string]$Form = 'd50',
  [string]$Out = 'd67-2500.json',
  [int]$MaxActions = 2500,
  [string]$Edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$page = Join-Path $root 'preflight\bot_d67.html'
$q = '?n=' + $Runs + '&adapt=' + $Adaptive + '&form=' + $Form
if ($Only -ne '') { $q = $q + '&only=' + $Only }
if ($MaxActions -ne 2500) { $q = $q + '&ma=' + $MaxActions }
$uri = ([System.Uri]$page).AbsoluteUri + $q
$tag = [guid]::NewGuid().ToString('N').Substring(0, 6)
$tmp = Join-Path $env:TEMP ('d67dom_' + $tag + '.html')
$ud = Join-Path $env:TEMP ('d67ud_' + $tag)
$eargs = @(
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--allow-file-access-from-files', '--hide-scrollbars', "--user-data-dir=$ud",
  '--window-size=1024,640', '--virtual-time-budget=2400000', '--dump-dom', $uri
)
Start-Process -FilePath $Edge -ArgumentList $eargs -NoNewWindow -Wait `
  -RedirectStandardOutput $tmp -RedirectStandardError ($tmp + '.err')
$dom = Get-Content -LiteralPath $tmp -Raw -Encoding UTF8
$mt = [regex]::Match($dom, '(?s)<pre id="report">(.*?)</pre>')
if (-not $mt.Success) { throw 'd67-report.ps1: no #report output' }
$json = $mt.Groups[1].Value.Replace('&lt;', '<').Replace('&gt;', '>').Replace('&quot;', '"').Replace('&#39;', "'").Replace('&amp;', '&')
$obj = $json | ConvertFrom-Json
if (-not $obj.ok) { throw ('d67-report.ps1: ' + $obj.err) }
$outPath = Join-Path $root ('preflight\selfcheck\' + $Out)
[System.IO.File]::WriteAllText($outPath, $json, (New-Object System.Text.UTF8Encoding($false)))
$rows = @()
foreach ($k in @('b1','g2','s1','m1')) {
  if ($obj.agg.$k) {
    $a = $obj.agg.$k
    $reach = @(); foreach ($f in @('1','2','3','4','5')) { $reach += $f + ':' + $a.floorReach.$f }
    $rows += ($k + ' win=' + $a.wins + ' dead=' + $a.dead + ' stuck=' + $a.stuck +
      ' reach[' + ($reach -join ',') + '] cap=' + $a.capN + ' avgSteps=' + $a.avgSteps +
      ' avgLv=' + $a.avgLevel + ' avgKills=' + $a.avgKills)
  }
}
foreach ($b in @('ogre_boss','zombie_king','dragon')) {
  if ($obj.boss.$b) {
    $x = $obj.boss.$b
    $rows += ('boss ' + $b + ' def=' + $x.def + ' hp=' + $x.hp + ' battles=' + $x.battles +
      ' wins=' + $x.wins + ' roundsMed=' + $x.roundsMed + ' range=' + $x.roundsMin + '-' + $x.roundsMax +
      ' lossShortMed=' + $x.lossShortMed)
  }
}
foreach ($k in @('b1','g2','s1','m1')) {
  if ($obj.enc.$k) {
    $e = $obj.enc.$k
    $per = @(); foreach ($f in @('F1','F2','F3','F4','F5')) { $per += $f + ':' + $e.byFloor.$f.avg }
    $rows += ('enc ' + $k + ' totalAvg=' + $e.totalAvg + ' [' + ($per -join ',') + ']')
  }
}
if ($obj.exitHp) {
  $per = @(); foreach ($f in @('F1','F2','F3','F4','F5')) { if ($obj.exitHp.$f) { $per += $f + ':' + $obj.exitHp.$f.med } }
  $rows += ('b1 exitHp med [' + ($per -join ',') + ']')
}
if ($obj.rounds) {
  foreach ($x in $obj.rounds.bosses) {
    $rows += ('static boss ' + $x.id + ' def=' + $x.def + ' atkMed=' + $x.atkMed +
      ' roundsMed=' + $x.roundsMed + ' surviveMed=' + $x.surviveMed + ' ratio=' + $x.ratioMed)
  }
  foreach ($f in @('F3','F4','F5')) {
    $row = $obj.rounds.floors.$f
    $rows += ($f + ' normal rounds: ' + (($row.enemies | ForEach-Object { $_.id + '=' + $_.roundsMed }) -join ' '))
  }
}
if ($obj.exitHpM1) {
  $per = @(); foreach ($f in @('F1','F2','F3','F4','F5')) { if ($obj.exitHpM1.$f) { $per += $f + ':' + $obj.exitHpM1.$f.med } }
  $rows += ('m1 exitHp med [' + ($per -join ',') + ']')
}
Remove-Item $tmp, ($tmp + '.err'), $ud -Recurse -Force -ErrorAction SilentlyContinue
Write-Output ($rows -join "`n")
Write-Output ('-> ' + $outPath)
