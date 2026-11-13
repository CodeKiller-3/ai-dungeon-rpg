# preflight/selfcheck/d65-probe.ps1 - D-65: B1 attribution + M1 exit panels (read-only)
# usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File preflight\selfcheck\d65-probe.ps1 -Out d65-probe.json [-Mode all|b1|m1] [-Runs 50]
param(
  [string]$Out = 'd65-probe.json',
  [string]$Mode = 'all',
  [int]$Runs = 50,
  [int]$Ma = 6000,
  [int]$Budget = 240000,
  [string]$Edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$page = Join-Path $root 'preflight\probe_d65.html'
$uri = ([System.Uri]$page).AbsoluteUri + ('?mode=' + $Mode + '&n=' + $Runs + '&ma=' + $Ma)
$tag = [guid]::NewGuid().ToString('N').Substring(0, 6)
$tmp = Join-Path $env:TEMP ('d65probe_' + $tag + '.html')
$ud = Join-Path $env:TEMP ('d65probeud_' + $tag)

$eargs = @(
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--allow-file-access-from-files', '--hide-scrollbars', "--user-data-dir=$ud",
  '--window-size=1024,640', ("--virtual-time-budget=" + $Budget), '--dump-dom', $uri
)
Start-Process -FilePath $Edge -ArgumentList $eargs -NoNewWindow -Wait `
  -RedirectStandardOutput $tmp -RedirectStandardError ($tmp + '.err')

$dom = Get-Content -LiteralPath $tmp -Raw -Encoding UTF8
$mt = [regex]::Match($dom, '(?s)<pre id="report">(.*?)</pre>')
if (-not $mt.Success) { throw 'd65-probe.ps1: no #report output' }
$json = $mt.Groups[1].Value
$json = $json.Replace('&lt;', '<').Replace('&gt;', '>').Replace('&quot;', '"').Replace('&#39;', "'").Replace('&amp;', '&')
$obj = $json | ConvertFrom-Json
if (-not $obj.ok) { throw ('d65-probe.ps1: probe failed: ' + $obj.err) }

$outPath = Join-Path $root ('preflight\selfcheck\' + $Out)
[System.IO.File]::WriteAllText($outPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Remove-Item $tmp, ($tmp + '.err'), $ud -Recurse -Force -ErrorAction SilentlyContinue
Write-Output ('probe -> ' + $outPath)
