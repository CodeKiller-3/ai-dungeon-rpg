# preflight/selfcheck/d23-report.ps1 - D-23: run bot attribution batch page, dump d23-report.json
# usage: powershell -NoProfile -ExecutionPolicy Bypass -File preflight\selfcheck\d23-report.ps1 -Runs 50
param(
  [int]$Runs = 50,
  [string]$Edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$page = Join-Path $root 'preflight\bot_d23.html'
$uri = ([System.Uri]$page).AbsoluteUri + ('?n=' + $Runs)
$tmp = Join-Path $env:TEMP ('d23dom_' + [guid]::NewGuid().ToString('N').Substring(0, 6) + '.html')
$ud = Join-Path $env:TEMP ('d23ud_' + [guid]::NewGuid().ToString('N').Substring(0, 6))

$eargs = @(
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--allow-file-access-from-files', '--hide-scrollbars', "--user-data-dir=$ud",
  '--window-size=1024,640', '--virtual-time-budget=900000', '--dump-dom', $uri
)
Start-Process -FilePath $Edge -ArgumentList $eargs -NoNewWindow -Wait `
  -RedirectStandardOutput $tmp -RedirectStandardError ($tmp + '.err')

$dom = Get-Content -LiteralPath $tmp -Raw -Encoding UTF8
$m = [regex]::Match($dom, '(?s)<pre id="report">(.*?)</pre>')
if (-not $m.Success) { throw 'd23-report.ps1: page did not emit #report (BATCH_FAIL, see title)' }
$json = $m.Groups[1].Value
$json = $json.Replace('&lt;', '<').Replace('&gt;', '>').Replace('&quot;', '"').Replace('&#39;', "'").Replace('&amp;', '&')

$obj = $json | ConvertFrom-Json
if (-not $obj.ok) { throw ('d23-report.ps1: batch failed: ' + $obj.err) }

$out = Join-Path $root 'preflight\selfcheck\d23-report.json'
[System.IO.File]::WriteAllText($out, $json, (New-Object System.Text.UTF8Encoding($false)))

Get-ChildItem -LiteralPath $tmp, ($tmp + '.err') -ErrorAction SilentlyContinue | Remove-Item -Force
Remove-Item -LiteralPath $ud -Recurse -Force -ErrorAction SilentlyContinue

$a = $obj.attribution
Write-Output ('runs=' + $obj.runs.Count + ' dead=' + $obj.summary.dead + ' deaths=' + $a.deadRuns +
  ' trap=' + $a.trapDeaths + ' noTelemetry=' + $a.noTelemetry + ' wallMs=' + $obj.wallMs)
Write-Output '--- killers (desc) ---'
foreach ($r in $a.byKiller) {
  Write-Output ('  {0,-22} {1,3}  {2,5}%  lv={3} rnd={4} pot={5} hp%={6} wp={7} ar={8}' -f `
    $r.name, $r.count, $r.pct, $r.avgLevel, $r.avgRound, $r.avgPotionsLeft, $r.avgHpPct, $r.topWeapon, $r.topArmor)
}
Write-Output '--- floors ---'
foreach ($f in $a.byFloor) { Write-Output ('  F' + $f.floor + ' = ' + $f.count) }
Write-Output ('missingFieldCounts=' + ($a.missingFieldCounts | ConvertTo-Json -Compress))
Write-Output ('-> ' + $out)
