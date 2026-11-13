# preflight/selfcheck/d71-report.ps1 - D-71: same-seed batch at a fixed FX level
# usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File preflight\selfcheck\d71-report.ps1 -Runs 50 -Only b1 -MaxActions 2500 -Fx off -Out d71-fx-off.json
param(
  [int]$Runs = 50,
  [string]$Only = '',
  [int]$Adaptive = 1,
  [string]$Form = 'd50',
  [string]$Out = 'd71-b1-2500.json',
  [int]$MaxActions = 6000,
  [string]$Fx = 'low',
  [string]$Edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$page = Join-Path $root 'preflight\bot_d71.html'
$q = '?n=' + $Runs + '&adapt=' + $Adaptive + '&form=' + $Form
if ($Only -ne '') { $q = $q + '&only=' + $Only }
$q = $q + '&ma=' + $MaxActions + '&fx=' + $Fx
$uri = ([System.Uri]$page).AbsoluteUri + $q
$tag = [guid]::NewGuid().ToString('N').Substring(0, 6)
$tmp = Join-Path $env:TEMP ('d70dom_' + $tag + '.html')
$ud = Join-Path $env:TEMP ('d70ud_' + $tag)
$eargs = @(
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--allow-file-access-from-files', '--hide-scrollbars', "--user-data-dir=$ud",
  '--window-size=1024,640', '--virtual-time-budget=2400000', '--dump-dom', $uri
)
Start-Process -FilePath $Edge -ArgumentList $eargs -NoNewWindow -Wait `
  -RedirectStandardOutput $tmp -RedirectStandardError ($tmp + '.err')
$dom = Get-Content -LiteralPath $tmp -Raw -Encoding UTF8
$mt = [regex]::Match($dom, '(?s)<pre id="report">(.*?)</pre>')
if (-not $mt.Success) { throw 'd71-report.ps1: no #report output' }
$json = $mt.Groups[1].Value.Replace('&lt;', '<').Replace('&gt;', '>').Replace('&quot;', '"').Replace('&#39;', "'").Replace('&amp;', '&')
$obj = $json | ConvertFrom-Json
if (-not $obj.ok) { throw ('d71-report.ps1: ' + $obj.err) }
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
    $rows += ('boss ' + $b + ' roundsMed=' + $x.roundsMed + ' winMed=' + $x.roundsWinMed +
      ' battles=' + $x.battles + ' wins=' + $x.wins)
  }
}
Write-Output ('fx=' + $obj.env.fx + ' only=' + $Only + ' ma=' + $obj.env.maxActions)
Write-Output ($rows -join "`n")
Write-Output ('-> ' + $outPath)

