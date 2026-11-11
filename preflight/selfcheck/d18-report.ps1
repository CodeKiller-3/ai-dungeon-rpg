# preflight/selfcheck/d18-report.ps1 — D-18：跑校准后的 bot 批量页并落盘 d18-report.json
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File preflight\selfcheck\d18-report.ps1 -Runs 50
param(
  [int]$Runs = 50,
  [string]$Edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # 仓库根
$page = Join-Path $root 'preflight\bot_d18.html'
$uri = ([System.Uri]$page).AbsoluteUri + ('?n=' + $Runs)
$tmp = Join-Path $env:TEMP ('d18dom_' + [guid]::NewGuid().ToString('N').Substring(0, 6) + '.html')
$ud  = Join-Path $env:TEMP ('d18ud_'  + [guid]::NewGuid().ToString('N').Substring(0, 6))

$eargs = @(
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--allow-file-access-from-files', '--hide-scrollbars', "--user-data-dir=$ud",
  '--window-size=1024,640', '--virtual-time-budget=600000', '--dump-dom', $uri
)
Start-Process -FilePath $Edge -ArgumentList $eargs -NoNewWindow -Wait `
  -RedirectStandardOutput $tmp -RedirectStandardError ($tmp + '.err')

$dom = Get-Content -LiteralPath $tmp -Raw -Encoding UTF8
$m = [regex]::Match($dom, '(?s)<pre id="report">(.*?)</pre>')
if (-not $m.Success) { throw 'd18-report.ps1: 页面没有输出 #report（可能 BATCH_FAIL，见 title）' }
$json = $m.Groups[1].Value
$json = $json.Replace('&lt;', '<').Replace('&gt;', '>').Replace('&quot;', '"').Replace('&#39;', "'").Replace('&amp;', '&')

# 自校验：必须是合法 JSON，且 ok=true
$obj = $json | ConvertFrom-Json
if (-not $obj.ok) { throw ('d18-report.ps1: 批量跑局失败：' + $obj.err) }

$out = Join-Path $root 'preflight\selfcheck\d18-report.json'
[System.IO.File]::WriteAllText($out, $json, (New-Object System.Text.UTF8Encoding($false)))

Remove-Item $tmp, ($tmp + '.err'), $ud -Recurse -Force -ErrorAction SilentlyContinue

$s = $obj.summary
Write-Output ('runs=' + $s.runs + ' win=' + $s.win + ' dead=' + $s.dead + ' stuck=' + $s.stuck +
  ' winRate=' + $s.winRate + ' wallMs=' + $obj.wallMs)
Write-Output ('deathFloorDist=' + ($s.deathFloorDist | ConvertTo-Json -Compress))
Write-Output ('deathCauses=' + ($s.deathCauses | ConvertTo-Json -Compress))
Write-Output ('shop=' + ($s.shop | ConvertTo-Json -Compress))
Write-Output ('goblin=' + ($s.goblinQuest | ConvertTo-Json -Compress))
Write-Output ('crashes=' + $obj.spy.crashes)
Write-Output ('-> ' + $out)
