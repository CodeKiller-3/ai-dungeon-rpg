# preflight/selfcheck/d66-probe.ps1 - D-66: kill rounds / exit HP from a bot run JSON (read-only)
# usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File preflight\selfcheck\d66-probe.ps1 -Src d65-probe-after.json -Tag before -Out d66-rounds-before.json
param(
  [string]$Src = 'd65-probe-after.json',
  [string]$Tag = 'before',
  [string]$Out = 'd66-rounds.json',
  [string]$Edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$page = Join-Path $root 'preflight\probe_d66.html'
$uri = ([System.Uri]$page).AbsoluteUri + '?src=' + $Src + '&tag=' + $Tag
$tmp = Join-Path $env:TEMP ('d66probe_' + [guid]::NewGuid().ToString('N').Substring(0, 6) + '.html')
$ud = Join-Path $env:TEMP ('d66ud_' + [guid]::NewGuid().ToString('N').Substring(0, 6))
$eargs = @(
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--allow-file-access-from-files', '--hide-scrollbars', "--user-data-dir=$ud",
  '--window-size=1024,640', '--virtual-time-budget=30000', '--dump-dom', $uri
)
Start-Process -FilePath $Edge -ArgumentList $eargs -NoNewWindow -Wait `
  -RedirectStandardOutput $tmp -RedirectStandardError ($tmp + '.err')
$dom = Get-Content -LiteralPath $tmp -Raw -Encoding UTF8
$mt = [regex]::Match($dom, '(?s)<pre id="report">(.*?)</pre>')
if (-not $mt.Success) { throw 'd66-probe.ps1: no #report output' }
$json = $mt.Groups[1].Value.Replace('&lt;', '<').Replace('&gt;', '>').Replace('&quot;', '"').Replace('&#39;', "'").Replace('&amp;', '&')
$obj = $json | ConvertFrom-Json
if (-not $obj.ok) { throw ('d66-probe.ps1: ' + $obj.err) }
$outPath = Join-Path $root ('preflight\selfcheck\' + $Out)
[System.IO.File]::WriteAllText($outPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Remove-Item $tmp, ($tmp + '.err'), $ud -Recurse -Force -ErrorAction SilentlyContinue
Write-Output ('rounds -> ' + $outPath)
