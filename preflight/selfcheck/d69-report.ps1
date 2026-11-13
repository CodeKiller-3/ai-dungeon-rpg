# preflight/selfcheck/d69-report.ps1 - D-69: elite battles + entry/mid/exit median kill rounds
# usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File preflight\selfcheck\d69-report.ps1 -Runs 50 -Only m1 -MaxActions 6000 -Out d69-pf-m16000.json
param(
  [int]$Runs = 50,
  [string]$Only = '',
  [int]$Adaptive = 1,
  [string]$Form = 'd50',
  [string]$Out = 'd69-pf-m16000.json',
  [int]$MaxActions = 6000,
  [string]$Edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$page = Join-Path $root 'preflight\bot_d69.html'
$q = '?n=' + $Runs + '&adapt=' + $Adaptive + '&form=' + $Form
if ($Only -ne '') { $q = $q + '&only=' + $Only }
$q = $q + '&ma=' + $MaxActions
$uri = ([System.Uri]$page).AbsoluteUri + $q
$tag = [guid]::NewGuid().ToString('N').Substring(0, 6)
$tmp = Join-Path $env:TEMP ('d69dom_' + $tag + '.html')
$ud = Join-Path $env:TEMP ('d69ud_' + $tag)
$eargs = @(
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--allow-file-access-from-files', '--hide-scrollbars', "--user-data-dir=$ud",
  '--window-size=1024,640', '--virtual-time-budget=2400000', '--dump-dom', $uri
)
Start-Process -FilePath $Edge -ArgumentList $eargs -NoNewWindow -Wait `
  -RedirectStandardOutput $tmp -RedirectStandardError ($tmp + '.err')
$dom = Get-Content -LiteralPath $tmp -Raw -Encoding UTF8
$mt = [regex]::Match($dom, '(?s)<pre id="report">(.*?)</pre>')
if (-not $mt.Success) { throw 'd69-report.ps1: no #report output' }
$json = $mt.Groups[1].Value.Replace('&lt;', '<').Replace('&gt;', '>').Replace('&quot;', '"').Replace('&#39;', "'").Replace('&amp;', '&')
$obj = $json | ConvertFrom-Json
if (-not $obj.ok) { throw ('d69-report.ps1: ' + $obj.err) }
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
if ($obj.curve) {
  foreach ($ck in @('m1','b1')) {
    if (-not $obj.curve.$ck) { continue }
    $rows += ('--- curve ' + $ck + ' (staticMed / actualMed / n / atkMed) ---')
    foreach ($f in @('F1','F2','F3','F4','F5')) {
      $row = $obj.curve.$ck.$f
      if (-not $row) { continue }
      $rows += ($f + ' in=' + $row.entry.staticMed + '/' + $row.entry.actualMed + '(n' + $row.entry.n + ',atk' + $row.entry.atkMed + ',fb' + $row.entry.fb + ')' +
        ' mid=' + $row.mid.staticMed + '/' + $row.mid.actualMed + '(n' + $row.mid.n + ',atk' + $row.mid.atkMed + ',fb' + $row.mid.fb + ')' +
        ' out=' + $row.exit.staticMed + '/' + $row.exit.actualMed + '(n' + $row.exit.n + ',atk' + $row.exit.atkMed + ',fb' + $row.exit.fb + ')' +
        ' gap=' + $row.gapPct + '% pass=' + $row.pass)
    }
  }
}
foreach ($b in @('ogre_boss','zombie_king','dragon')) {
  if ($obj.boss.$b) {
    $x = $obj.boss.$b
    $rows += ('boss ' + $b + ' def=' + $x.def + ' hp=' + $x.hp + ' battles=' + $x.battles +
      ' wins=' + $x.wins + ' roundsMed=' + $x.roundsMed + ' winMed=' + $x.roundsWinMed + ' range=' + $x.roundsMin + '-' + $x.roundsMax +
      ' lossShortMed=' + $x.lossShortMed)
  }
}
foreach ($k in @('b1','g2','s1','m1')) {
  if ($obj.elite.$k) {
    $e = $obj.elite.$k
    $per = @(); foreach ($f in @('F1','F2','F3','F4','F5')) {
      $pf = $e.byFloor.$f; if ($pf) { $per += $f + ':' + $pf.wins + '/' + $pf.n + ' med' + $pf.roundsMed }
    }
    $rows += ('elite ' + $k + ' battles=' + $e.battles + ' wins=' + $e.wins + ' flees=' + $e.flees +
      ' roundsMed=' + $e.roundsMed + ' winMed=' + $e.roundsWinMed + ' range=' + $e.roundsMin + '-' + $e.roundsMax +
      ' [' + ($per -join ',') + ']')
    $nx = $obj.eliteNext.$k
    if ($nx) {
      $rows += ('eliteNext ' + $k + ' n=' + $nx.n + ' before=' + $nx.roundsBeforeMed +
        ' after=' + $nx.roundsAfterMed + ' drop=' + $nx.roundDropMed + ' atkGain=' + $nx.atkGainMed)
    }
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
if ($obj.exitHpM1) {
  $per = @(); foreach ($f in @('F1','F2','F3','F4','F5')) { if ($obj.exitHpM1.$f) { $per += $f + ':' + $obj.exitHpM1.$f.med } }
  $rows += ('m1 exitHp med [' + ($per -join ',') + ']')
}
Remove-Item $tmp, ($tmp + '.err'), $ud -Recurse -Force -ErrorAction SilentlyContinue
Write-Output ($rows -join "`n")
Write-Output ('-> ' + $outPath)
