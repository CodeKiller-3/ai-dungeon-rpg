# preflight/selfcheck/d37-report.ps1 - D-37: run one bot group per page load, save d37-g*.json
# usage: powershell -NoProfile -ExecutionPolicy Bypass -File preflight\selfcheck\d37-report.ps1 -Runs 50
# Each group gets its own file (d37-g0.json .. d37-g3.json); nothing is overwritten across groups.
param(
  [int]$Runs = 50,
  [string]$Groups = 'G0,G1,G2,G3',
  [string]$Edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$page = Join-Path $root 'preflight\bot_d37.html'

foreach ($g in ($Groups -split ',')) {
  $g = $g.Trim().ToUpper()
  $uri = ([System.Uri]$page).AbsoluteUri + ('?g=' + $g + '&n=' + $Runs)
  $tag = [guid]::NewGuid().ToString('N').Substring(0, 6)
  $tmp = Join-Path $env:TEMP ('d37dom_' + $tag + '.html')
  $ud = Join-Path $env:TEMP ('d37ud_' + $tag)

  $eargs = @(
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--allow-file-access-from-files', '--hide-scrollbars', "--user-data-dir=$ud",
    '--window-size=1024,640', '--virtual-time-budget=900000', '--dump-dom', $uri
  )
  Start-Process -FilePath $Edge -ArgumentList $eargs -NoNewWindow -Wait `
    -RedirectStandardOutput $tmp -RedirectStandardError ($tmp + '.err')

  $dom = Get-Content -LiteralPath $tmp -Raw -Encoding UTF8
  $m = [regex]::Match($dom, '(?s)<pre id="report">(.*?)</pre>')
  if (-not $m.Success) { throw ('d37-report.ps1: no #report output for ' + $g + ' (maybe BATCH_FAIL, see title)') }
  $json = $m.Groups[1].Value
  $json = $json.Replace('&lt;', '<').Replace('&gt;', '>').Replace('&quot;', '"').Replace('&#39;', "'").Replace('&amp;', '&')

  $obj = $json | ConvertFrom-Json
  if (-not $obj.ok) { throw ('d37-report.ps1: batch failed for ' + $g + ': ' + $obj.err) }

  $file = 'd37-' + $g.ToLower() + '.json'
  $out = Join-Path $root ('preflight\selfcheck\' + $file)
  [System.IO.File]::WriteAllText($out, $json, (New-Object System.Text.UTF8Encoding($false)))

  Remove-Item $tmp, ($tmp + '.err'), $ud -Recurse -Force -ErrorAction SilentlyContinue

  $s = $obj.summary
  $d = $s.d37
  Write-Output ($g + ' runs=' + $s.runs + ' win=' + $s.win + ' dead=' + $s.dead + ' stuck=' + $s.stuck +
    ' fireball=' + $d.fireball.casts + ' flee=' + $d.flee.successes + '/' + $d.flee.attempts +
    ' grind=' + $d.grind.kills + ' wallMs=' + $obj.wallMs + ' -> ' + $out)
}
