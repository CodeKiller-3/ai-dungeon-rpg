# preflight/selfcheck/d27-report.ps1 - D-27: rerun 50 bot games, dump d27-report.json
# (d23-report.json / d19-report.json are read-only inputs here; never overwritten)
# usage: powershell -NoProfile -ExecutionPolicy Bypass -File preflight\selfcheck\d27-report.ps1 -Runs 50
param(
  [int]$Runs = 50,
  [string]$Edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
)
$ErrorActionPreference = 'Stop'
$self = Join-Path (Get-Location).Path 'preflight\selfcheck'
$root = Split-Path -Parent (Split-Path -Parent $self)
$page = Join-Path $root 'preflight\bot_d23.html'
$uri = ([System.Uri]$page).AbsoluteUri + ('?n=' + $Runs)
$tmp = Join-Path $env:TEMP ('d27dom_' + [guid]::NewGuid().ToString('N').Substring(0, 6) + '.html')
$ud = Join-Path $env:TEMP ('d27ud_' + [guid]::NewGuid().ToString('N').Substring(0, 6))

$eargs = @(
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--allow-file-access-from-files', '--hide-scrollbars', "--user-data-dir=$ud",
  '--window-size=1024,640', '--virtual-time-budget=900000', '--dump-dom', $uri
)
Start-Process -FilePath $Edge -ArgumentList $eargs -NoNewWindow -Wait `
  -RedirectStandardOutput $tmp -RedirectStandardError ($tmp + '.err')

$dom = Get-Content -LiteralPath $tmp -Raw -Encoding UTF8
$m = [regex]::Match($dom, '(?s)<pre id="report">(.*?)</pre>')
if (-not $m.Success) { throw 'd27-report.ps1: page did not emit #report (BATCH_FAIL, see title)' }
$json = $m.Groups[1].Value
$json = $json.Replace('&lt;', '<').Replace('&gt;', '>').Replace('&quot;', '"').Replace('&#39;', "'").Replace('&amp;', '&')

$obj = $json | ConvertFrom-Json
if (-not $obj.ok) { throw ('d27-report.ps1: batch failed: ' + $obj.err) }

$out = Join-Path $root 'preflight\selfcheck\d27-report.json'
[System.IO.File]::WriteAllText($out, $json, (New-Object System.Text.UTF8Encoding($false)))

Get-ChildItem -LiteralPath $tmp, ($tmp + '.err') -ErrorAction SilentlyContinue | Remove-Item -Force
Remove-Item -LiteralPath $ud -Recurse -Force -ErrorAction SilentlyContinue

function Avg-Of($runs, [string]$field) {
  $vals = @($runs | ForEach-Object { $_.$field } | Where-Object { $null -ne $_ })
  if ($vals.Count -eq 0) { return $null }
  return [math]::Round((($vals | Measure-Object -Average).Average), 1)
}
function Floor-Map($attribution) {
  $h = @{}
  foreach ($f in $attribution.byFloor) { $h[[string]$f.floor] = $f.count }
  return $h
}

$a = $obj.attribution
Write-Output ('runs=' + $obj.runs.Count + ' dead=' + $obj.summary.dead + ' deaths=' + $a.deadRuns +
  ' trap=' + $a.trapDeaths + ' noTelemetry=' + $a.noTelemetry + ' wallMs=' + $obj.wallMs)
Write-Output ('missingFieldCounts=' + ($a.missingFieldCounts | ConvertTo-Json -Compress))
Write-Output ('avgActions=' + (Avg-Of $obj.runs 'actions') + ' avgLevel=' + (Avg-Of $obj.runs 'level'))

$d23Path = Join-Path $self 'd23-report.json'
if (Test-Path -LiteralPath $d23Path) {
  $d23 = Get-Content -LiteralPath $d23Path -Raw -Encoding UTF8 | ConvertFrom-Json
  $f23 = Floor-Map $d23.attribution
  $f27 = Floor-Map $a
  Write-Output '--- D-23 -> D-27 contrast ---'
  Write-Output ('avgActions        ' + (Avg-Of $d23.runs 'actions') + ' -> ' + (Avg-Of $obj.runs 'actions'))
  Write-Output ('deaths            ' + $d23.attribution.deadRuns + ' -> ' + $a.deadRuns)
  foreach ($k in @('1','2','3','4','5')) {
    $x = if ($f23.ContainsKey($k)) { $f23[$k] } else { 0 }
    $y = if ($f27.ContainsKey($k)) { $f27[$k] } else { 0 }
    Write-Output ('deaths on F' + $k + '       ' + $x + ' -> ' + $y)
  }
  Write-Output ('weaponId:null     ' + $d23.attribution.missingFieldCounts.'weaponId:null' +
    ' -> ' + $a.missingFieldCounts.'weaponId:null')
  Write-Output ('armorId:null      ' + $d23.attribution.missingFieldCounts.'armorId:null' +
    ' -> ' + $a.missingFieldCounts.'armorId:null')
  Write-Output ('byCause D-23      ' + (($d23.attribution.byCause | ConvertTo-Json -Compress)))
  Write-Output ('byCause D-27      ' + (($a.byCause | ConvertTo-Json -Compress)))
}
Write-Output ('-> ' + $out)
