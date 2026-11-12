# preflight/selfcheck/d39-report.ps1 - D-39: run the stealth bot (S1) and the negative control, save JSON
# usage: powershell -NoProfile -ExecutionPolicy Bypass -File preflight\selfcheck\d39-report.ps1 -Runs 50
# s1  -> preflight/selfcheck/d39-s1.json   (pure stealth: monster tiles are obstacles)
# neg -> preflight/selfcheck/d39-neg.json   (negative control: avoid=false, plain D-34/D-37 pathing)
# Same seeds 1001..1000+N and maxActions 2500 as D-37 G2; never overwrites any D-37 artifact.
param(
  [int]$Runs = 50,
  [string]$Modes = 's1,neg',
  [string]$Edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$page = Join-Path $root 'preflight\bot_d39.html'

foreach ($m in ($Modes -split ',')) {
  $m = $m.Trim().ToLower()
  $uri = ([System.Uri]$page).AbsoluteUri + ('?mode=' + $m + '&n=' + $Runs)
  $tag = [guid]::NewGuid().ToString('N').Substring(0, 6)
  $tmp = Join-Path $env:TEMP ('d39dom_' + $tag + '.html')
  $ud = Join-Path $env:TEMP ('d39ud_' + $tag)

  $eargs = @(
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--allow-file-access-from-files', '--hide-scrollbars', "--user-data-dir=$ud",
    '--window-size=1024,640', '--virtual-time-budget=900000', '--dump-dom', $uri
  )
  Start-Process -FilePath $Edge -ArgumentList $eargs -NoNewWindow -Wait `
    -RedirectStandardOutput $tmp -RedirectStandardError ($tmp + '.err')

  $dom = Get-Content -LiteralPath $tmp -Raw -Encoding UTF8
  $mt = [regex]::Match($dom, '(?s)<pre id="report">(.*?)</pre>')
  if (-not $mt.Success) { throw ('d39-report.ps1: no #report output for ' + $m + ' (maybe BATCH_FAIL, see title)') }
  $json = $mt.Groups[1].Value
  $json = $json.Replace('&lt;', '<').Replace('&gt;', '>').Replace('&quot;', '"').Replace('&#39;', "'").Replace('&amp;', '&')

  $obj = $json | ConvertFrom-Json
  if (-not $obj.ok) { throw ('d39-report.ps1: batch failed for ' + $m + ': ' + $obj.err) }

  $file = 'd39-' + $m + '.json'
  $out = Join-Path $root ('preflight\selfcheck\' + $file)
  [System.IO.File]::WriteAllText($out, $json, (New-Object System.Text.UTF8Encoding($false)))

  Remove-Item $tmp, ($tmp + '.err'), $ud -Recurse -Force -ErrorAction SilentlyContinue

  $s = $obj.summary
  $d = $s.d39
  Write-Output ($m + ' runs=' + $s.runs + ' win=' + $s.win + ' dead=' + $s.dead + ' stuck=' + $s.stuck +
    ' f5=' + $d.f5.reached + ' battles=' + $d.encounters.battles + ' forced=' + $d.encounters.forced +
    ' active=' + $d.encounters.active + ' blocked=' + $d.blocked.events +
    ' flee=' + $d.flee.successes + '/' + $d.flee.attempts + ' wallMs=' + $obj.wallMs + ' -> ' + $out)
}
