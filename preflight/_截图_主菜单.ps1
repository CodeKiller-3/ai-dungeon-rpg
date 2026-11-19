<#
  _截图_主菜单.ps1 — 主菜单美学评估实拍（临时脚本，_ 前缀，不登记 page-baseline.json）
  输出：docs/aesthetic/menu-aes/
#>
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $Root          # preflight/ -> 项目根
$ShotPage = Join-Path $Root 'preflight\_shot_menu_aes.html'
$OutDir = Join-Path $Root 'docs\aesthetic\menu-aes'
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }

function Find-Edge {
  $cands = @()
  if ($env:ProgramFiles) { $cands += (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe') }
  if (${env:ProgramFiles(x86)}) { $cands += (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe') }
  if ($env:LOCALAPPDATA) { $cands += (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe') }
  foreach ($p in $cands) { if (Test-Path $p) { return $p } }
  $cmd = Get-Command msedge.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}
$Edge = Find-Edge
if (-not $Edge) { throw '未找到 Microsoft Edge' }

$Jobs = @(
  @{ Name = 'menu-aes-01-root-nosave.png'; View = 'menu-root-nosave'; W = 1280; H = 800;  Budget = 5000 },
  @{ Name = 'menu-aes-02-root-save.png';   View = 'menu-root-save';   W = 1280; H = 800;  Budget = 5000 },
  @{ Name = 'menu-aes-03-help.png';        View = 'menu-help';        W = 1280; H = 800;  Budget = 5000 },
  @{ Name = 'menu-aes-04-settings.png';    View = 'menu-settings';    W = 1280; H = 800;  Budget = 5000 },
  @{ Name = 'menu-aes-05-confirm.png';     View = 'menu-confirm';     W = 1280; H = 800;  Budget = 5000 },
  @{ Name = 'menu-aes-06-about.png';       View = 'menu-about';       W = 1280; H = 800;  Budget = 5000 },
  @{ Name = 'menu-aes-07-root-1920.png';   View = 'menu-root-nosave'; W = 1920; H = 1080; Budget = 5000 },
  @{ Name = 'menu-aes-08-root-500.png';    View = 'menu-root-nosave'; W = 500;  H = 700;  Budget = 5000 },
  @{ Name = 'ref-dungeon-f1-explore.png';  View = 'ref-f1';           W = 1280; H = 800;  Budget = 9000 },
  @{ Name = 'ref-dungeon-f2-explore.png';  View = 'ref-f2';           W = 1280; H = 800;  Budget = 9000 },
  @{ Name = 'ref-dungeon-f3-explore.png';  View = 'ref-f3';           W = 1280; H = 800;  Budget = 9000 },
  @{ Name = 'ref-dungeon-f4-explore.png';  View = 'ref-f4';           W = 1280; H = 800;  Budget = 9000 },
  @{ Name = 'ref-dungeon-f5-explore.png';  View = 'ref-f5';           W = 1280; H = 800;  Budget = 9000 },
  @{ Name = 'ref-dungeon-battle-f2.png';   View = 'ref-battle-f2';    W = 1280; H = 800;  Budget = 9000 },
  @{ Name = 'ref-dungeon-boss-f5.png';     View = 'ref-boss-f5';      W = 1280; H = 800;  Budget = 9000 },
  @{ Name = 'ref-dungeon-bag.png';         View = 'ref-bag';          W = 1280; H = 800;  Budget = 9000 },
  @{ Name = 'ref-dungeon-system.png';      View = 'ref-system';       W = 1280; H = 800;  Budget = 9000 },
  @{ Name = 'ref-dungeon-settings.png';    View = 'ref-settings-modal'; W = 1280; H = 800; Budget = 9000 },
  @{ Name = 'ref-dungeon-pause.png';       View = 'ref-pause';        W = 1280; H = 800;  Budget = 9000 },
  @{ Name = 'ref-dungeon-guide.png';       View = 'ref-guide';        W = 1280; H = 800;  Budget = 9000 }
)

function Get-PngSize {
  param([string]$Path)
  $b = [System.IO.File]::ReadAllBytes($Path)
  if ($b.Length -lt 24) { return $null }
  $w = [int64]$b[16] * 16777216 + [int64]$b[17] * 65536 + [int64]$b[18] * 256 + [int64]$b[19]
  $h = [int64]$b[20] * 16777216 + [int64]$b[21] * 65536 + [int64]$b[22] * 256 + [int64]$b[23]
  return [pscustomobject]@{ W = [int]$w; H = [int]$h }
}

$rows = @()
try {
  foreach ($j in $Jobs) {
    $out = Join-Path $OutDir $j.Name
    if (Test-Path $out) { Remove-Item -Force $out }
    $ud = Join-Path $env:TEMP ('maes-shot-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $ud | Out-Null
    $url = ([System.Uri]$ShotPage).AbsoluteUri + '?view=' + $j.View
    $argList = @(
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--allow-file-access-from-files', '--hide-scrollbars', '--force-device-scale-factor=1',
      "--user-data-dir=$ud", "--window-size=$($j.W),$($j.H)",
      "--virtual-time-budget=$($j.Budget)", "--screenshot=$out", $url
    )
    $log = (& $Edge @argList 2>&1 | Out-String)
    $rc = $LASTEXITCODE
    for ($i = 0; $i -lt 20 -and -not (Test-Path $out); $i++) { Start-Sleep -Milliseconds 200 }
    if (-not (Test-Path $out)) { throw ("未落盘 {0}（rc={1}）`n{2}" -f $j.Name, $rc, ($log -join "`n")) }
    $len = (Get-Item $out).Length
    if ($len -le 0) { throw ("0 字节 {0}" -f $j.Name) }
    $sz = Get-PngSize $out
    if (-not $sz -or $sz.W -ne $j.W -or $sz.H -ne $j.H) {
      throw ("尺寸不符 {0}: {1}x{2}" -f $j.Name, $sz.W, $sz.H)
    }
    $rows += [pscustomobject]@{ File = $j.Name; W = $sz.W; H = $sz.H; Bytes = $len }
    Write-Host ("[OK] {0}  {1}x{2}  {3} B" -f $j.Name, $sz.W, $sz.H, $len) -ForegroundColor Green
    if (Test-Path $ud) { Remove-Item -Recurse -Force $ud -ErrorAction SilentlyContinue }
  }
  $rows | Format-Table -AutoSize | Out-String | Write-Host
  Write-Host ("SCREENSHOTS={0}/{1} OK" -f $rows.Count, $Jobs.Count) -ForegroundColor Green
  exit 0
} catch {
  Write-Host ('[失败] ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
} finally {
  Get-ChildItem $env:TEMP -Directory -Filter 'maes-shot-*' -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-Item -Recurse -Force $_.FullName -ErrorAction SilentlyContinue }
}
