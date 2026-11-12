# preflight/selfcheck/d41-report.ps1 - D-41: run M1/S1/G2 with one exp curve and save JSON
# usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File preflight\selfcheck\d41-report.ps1 -Out d41-after.json
#   powershell -NoProfile -ExecutionPolicy Bypass -File preflight\selfcheck\d41-report.ps1 -Early 60 -Late 60 -Out d41-legacy.json
# Same seeds 1001..1000+N and maxActions 2500 as D-37/D-39/D-40; never overwrites those artifacts.
param(
  [int]$Runs = 50,
  [int]$Early = 15,
  [int]$Late = 60,
  [string]$Mode = '',
  [string]$Out = 'd41-after.json',
  [string]$Edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$page = Join-Path $root 'preflight\bot_d41.html'

$q = '?n=' + $Runs + '&early=' + $Early + '&curve=' + $Late
if ($Mode -ne '') { $q = $q + '&mode=' + $Mode }
$uri = ([System.Uri]$page).AbsoluteUri + $q
$tag = [guid]::NewGuid().ToString('N').Substring(0, 6)
$tmp = Join-Path $env:TEMP ('d41dom_' + $tag + '.html')
$ud = Join-Path $env:TEMP ('d41ud_' + $tag)

$eargs = @(
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--allow-file-access-from-files', '--hide-scrollbars', "--user-data-dir=$ud",
  '--window-size=1024,640', '--virtual-time-budget=900000', '--dump-dom', $uri
)
Start-Process -FilePath $Edge -ArgumentList $eargs -NoNewWindow -Wait `
  -RedirectStandardOutput $tmp -RedirectStandardError ($tmp + '.err')

$dom = Get-Content -LiteralPath $tmp -Raw -Encoding UTF8
$mt = [regex]::Match($dom, '(?s)<pre id="report">(.*?)</pre>')
if (-not $mt.Success) { throw 'd41-report.ps1: no #report output (maybe BATCH_FAIL, see title)' }
$json = $mt.Groups[1].Value
$json = $json.Replace('&lt;', '<').Replace('&gt;', '>').Replace('&quot;', '"').Replace('&#39;', "'").Replace('&amp;', '&')

$obj = $json | ConvertFrom-Json
if (-not $obj.ok) { throw ('d41-report.ps1: batch failed: ' + $obj.err) }

if ($Mode -eq 'neg') {
  $outPathN = Join-Path $root ('preflight\selfcheck\' + $Out)
  [System.IO.File]::WriteAllText($outPathN, $json, (New-Object System.Text.UTF8Encoding($false)))
  Remove-Item $tmp, ($tmp + '.err'), $ud -Recurse -Force -ErrorAction SilentlyContinue
  Write-Output ('neg: newF3=' + $obj.neg.new.floorReach.'3' + ' oldF3=' + $obj.neg.old.floorReach.'3' +
    ' stallKills=' + $obj.neg.stall.killsPerRun + ' -> ' + $outPathN)
  return
}

$outPath = Join-Path $root ('preflight\selfcheck\' + $Out)
[System.IO.File]::WriteAllText($outPath, $json, (New-Object System.Text.UTF8Encoding($false)))

Remove-Item $tmp, ($tmp + '.err'), $ud -Recurse -Force -ErrorAction SilentlyContinue

$a = $obj.agg.m1.agg
$s = $obj.agg.s1.agg
Write-Output ('early=' + $obj.env.expEarlyBase + ' late=' + $obj.env.expCurveBase +
  ' m1: f3=' + $a.floorReach.'3' + '/50 f5=' + $a.f5.reached + ' f2kills=' + $a.floorKills.'2' +
  ' l5=' + $a.l5ByF3 + ' | s1: f5=' + $s.f5.reached + ' -> ' + $outPath)
