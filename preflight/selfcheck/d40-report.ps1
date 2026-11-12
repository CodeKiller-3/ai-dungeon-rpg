# preflight/selfcheck/d40-report.ps1 - D-40: run the "grind everything" bot (M1) and save JSON
# usage: powershell -NoProfile -ExecutionPolicy Bypass -File preflight\selfcheck\d40-report.ps1 -Runs 50
# m1 -> preflight/selfcheck/d40-m1.json
# Same seeds 1001..1000+N and maxActions 2500 as G0/G2/S1; never overwrites D-37/D-39 artifacts.
param(
  [int]$Runs = 50,
  [string]$Edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$page = Join-Path $root 'preflight\bot_d40.html'

$uri = ([System.Uri]$page).AbsoluteUri + ('?n=' + $Runs)
$tag = [guid]::NewGuid().ToString('N').Substring(0, 6)
$tmp = Join-Path $env:TEMP ('d40dom_' + $tag + '.html')
$ud = Join-Path $env:TEMP ('d40ud_' + $tag)

$eargs = @(
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--allow-file-access-from-files', '--hide-scrollbars', "--user-data-dir=$ud",
  '--window-size=1024,640', '--virtual-time-budget=900000', '--dump-dom', $uri
)
Start-Process -FilePath $Edge -ArgumentList $eargs -NoNewWindow -Wait `
  -RedirectStandardOutput $tmp -RedirectStandardError ($tmp + '.err')

$dom = Get-Content -LiteralPath $tmp -Raw -Encoding UTF8
$mt = [regex]::Match($dom, '(?s)<pre id="report">(.*?)</pre>')
if (-not $mt.Success) { throw 'd40-report.ps1: no #report output (maybe BATCH_FAIL, see title)' }
$json = $mt.Groups[1].Value
$json = $json.Replace('&lt;', '<').Replace('&gt;', '>').Replace('&quot;', '"').Replace('&#39;', "'").Replace('&amp;', '&')

$obj = $json | ConvertFrom-Json
if (-not $obj.ok) { throw ('d40-report.ps1: batch failed: ' + $obj.err) }

$out = Join-Path $root 'preflight\selfcheck\d40-m1.json'
[System.IO.File]::WriteAllText($out, $json, (New-Object System.Text.UTF8Encoding($false)))

Remove-Item $tmp, ($tmp + '.err'), $ud -Recurse -Force -ErrorAction SilentlyContinue

$s = $obj.summary
$d = $s.d40
Write-Output ('m1 runs=' + $s.runs + ' win=' + $s.win + ' dead=' + $s.dead + ' stuck=' + $s.stuck +
  ' f5=' + $d.f5.reached + ' extrap=' + $d.extrapolated.length +
  ' scrolls=' + $d.scrolls.total + ' wallMs=' + $obj.wallMs + ' -> ' + $out)
