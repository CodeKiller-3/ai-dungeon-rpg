# preflight/selfcheck/d43-report.ps1 - D-43: run M1/S1/G2 with HP ledger and save JSON
# usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File preflight\selfcheck\d43-report.ps1 -Out d43-after.json
#   powershell -NoProfile -ExecutionPolicy Bypass -File preflight\selfcheck\d43-report.ps1 -Mode neg -Out d43-neg.json
# Same seeds 1001..1000+N and maxActions 2500 as D-37/D-39/D-40/D-41/D-42; never overwrites those artifacts.
param(
  [int]$Runs = 50,
  [string]$Mode = '',
  [string]$Out = 'd43-after.json',
  [string]$Edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$page = Join-Path $root 'preflight\bot_d43.html'

$q = '?n=' + $Runs
if ($Mode -ne '') { $q = $q + '&mode=' + $Mode }
$uri = ([System.Uri]$page).AbsoluteUri + $q
$tag = [guid]::NewGuid().ToString('N').Substring(0, 6)
$tmp = Join-Path $env:TEMP ('d43dom_' + $tag + '.html')
$ud = Join-Path $env:TEMP ('d43ud_' + $tag)

$eargs = @(
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--allow-file-access-from-files', '--hide-scrollbars', "--user-data-dir=$ud",
  '--window-size=1024,640', '--virtual-time-budget=900000', '--dump-dom', $uri
)
Start-Process -FilePath $Edge -ArgumentList $eargs -NoNewWindow -Wait `
  -RedirectStandardOutput $tmp -RedirectStandardError ($tmp + '.err')

$dom = Get-Content -LiteralPath $tmp -Raw -Encoding UTF8
$mt = [regex]::Match($dom, '(?s)<pre id="report">(.*?)</pre>')
if (-not $mt.Success) { throw 'd43-report.ps1: no #report output (maybe BATCH_FAIL, see title)' }
$json = $mt.Groups[1].Value
$json = $json.Replace('&lt;', '<').Replace('&gt;', '>').Replace('&quot;', '"').Replace('&#39;', "'").Replace('&amp;', '&')

$obj = $json | ConvertFrom-Json
if (-not $obj.ok) { throw ('d43-report.ps1: batch failed: ' + $obj.err) }

$outPath = Join-Path $root ('preflight\selfcheck\' + $Out)
[System.IO.File]::WriteAllText($outPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Remove-Item $tmp, ($tmp + '.err'), $ud -Recurse -Force -ErrorAction SilentlyContinue

if ($Mode -eq 'neg') {
  Write-Output ('neg: newF3=' + $obj.neg.new.f3exit.avgHp + '(' + $obj.neg.new.f3exit.avgHpPct + '%)' +
    ' oldF3=' + $obj.neg.old.f3exit.avgHp + '(' + $obj.neg.old.f3exit.avgHpPct + '%)' + ' -> ' + $outPath)
  return
}

$a = $obj.d43.m1
$b = $obj.agg.m1.agg
$s = $obj.agg.s1.agg
$g = $obj.agg.g2.agg
Write-Output ('m1: f4=' + $b.floorReach.'4' + ' f5=' + $b.f5.reached +
  ' f3exit=' + $a.f3exit.avgHp + '(' + $a.f3exit.avgHpPct + '%)' +
  ' guard=' + $a.guard.avgPotionsGainedPerFloor + '/' + $a.guard.maxPotionUsesPerRun +
  ' | s1: f5=' + $s.f5.reached + ' | g2: f5=' + $g.f5.reached + ' -> ' + $outPath)
