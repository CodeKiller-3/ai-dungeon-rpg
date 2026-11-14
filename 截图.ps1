<#
  截图.ps1 — D-74 一键生成全部对外截图（10 张）

  用法：
    .\截图.cmd                          # 双击，或命令行直接跑
    powershell -NoProfile -ExecutionPolicy Bypass -File .\截图.ps1

  口径（沿用 D-61/D-73）：
    - 真实渲染、无后期；headless 下由 _shot_d73.html 隐去 FPS 段
    - 01–07 预算 8000；08 死亡 190000；09 结局 312000；10 首屏 1920×1080 预算 5000
    - 输出到 preflight/artifacts/d74/，不覆盖 d61/、d73/
    - 每张独立 --user-data-dir，跑完清理；先删旧文件，再核对"真的落盘 + 尺寸正确"
#>
$ErrorActionPreference = 'Stop'

# ── 路径全部从脚本位置推导，不写死盘符/用户名 ────────────────────
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ShotPage = Join-Path $Root 'preflight\_shot_d73.html'
$OutDir = Join-Path $Root 'preflight\artifacts\d74'
$Manifest = Join-Path $OutDir 'manifest.md'

if (-not (Test-Path $ShotPage)) {
  Write-Host "[失败] 找不到截图复现页：$ShotPage" -ForegroundColor Red
  exit 1
}
if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
}

# ── 找 Edge：标准安装路径 → PATH → 注册表 App Paths ──────────────
function Find-Edge {
  $cands = @()
  if ($env:ProgramFiles) { $cands += (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe') }
  if (${env:ProgramFiles(x86)}) { $cands += (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe') }
  if ($env:LOCALAPPDATA) { $cands += (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe') }
  foreach ($p in $cands) { if (Test-Path $p) { return $p } }
  $cmd = Get-Command msedge.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  try {
    $reg = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe' -ErrorAction Stop).'(default)'
    if ($reg -and (Test-Path $reg)) { return $reg }
  } catch { }
  return $null
}

$Edge = Find-Edge
if (-not $Edge) {
  Write-Host "[失败] 未找到 Microsoft Edge。本脚本用 Edge headless 出图；Windows 10/11 默认自带 Edge。" -ForegroundColor Red
  Write-Host "       如确实没有，请手动按 docs/运行说明.md 附录的命令用 Chrome 截图。" -ForegroundColor Yellow
  exit 1
}

# ── 任务表：名称 / view / 宽 / 高 / 虚拟时间预算 ──────────────────
$Jobs = @(
  @{ Name = '01-menu-nosave.png';    View = 'menu-nosave';    W = 1280; H = 800;  Budget = 5000 },
  @{ Name = '02-menu-save.png';      View = 'menu-save';      W = 1280; H = 800;  Budget = 5000 },
  @{ Name = '03-guide.png';          View = 'guide';          W = 1280; H = 800;  Budget = 5000 },
  @{ Name = '04-explore-elite.png';  View = 'explore-elite';  W = 1280; H = 800;  Budget = 8000 },
  @{ Name = '05-battle-crush.png';   View = 'battle-crush';   W = 1280; H = 800;  Budget = 8000 },
  @{ Name = '06-elite-loot.png';     View = 'elite-loot';     W = 1280; H = 800;  Budget = 8000 },
  @{ Name = '07-levelup.png';        View = 'levelup';        W = 1280; H = 800;  Budget = 8000 },
  @{ Name = '08-death.png';          View = 'death';          W = 1280; H = 800;  Budget = 190000 },
  @{ Name = '09-ending.png';         View = 'ending';         W = 1280; H = 800;  Budget = 312000 },
  @{ Name = '10-menu-1920.png';      View = 'menu-nosave';    W = 1920; H = 1080; Budget = 5000 }
)

# ── 读 PNG 头里的宽高（不依赖 System.Drawing）──────────────────
function Get-PngSize {
  param([string]$Path)
  $b = [System.IO.File]::ReadAllBytes($Path)
  if ($b.Length -lt 24) { return $null }
  $w = [int64]$b[16] * 16777216 + [int64]$b[17] * 65536 + [int64]$b[18] * 256 + [int64]$b[19]
  $h = [int64]$b[20] * 16777216 + [int64]$b[21] * 65536 + [int64]$b[22] * 256 + [int64]$b[23]
  return [pscustomobject]@{ W = [int]$w; H = [int]$h }
}

$rows = @()
$index = 0
try {
  foreach ($j in $Jobs) {
    $index++
    $out = Join-Path $OutDir $j.Name
    if (Test-Path $out) { Remove-Item -Force $out }   # 先删旧图，避免"旧文件冒充新落盘"

    $ud = Join-Path $env:TEMP ('d74-shot-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $ud | Out-Null
    $url = ([System.Uri]$ShotPage).AbsoluteUri + '?view=' + $j.View

    $argList = @(
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--allow-file-access-from-files', '--hide-scrollbars', '--force-device-scale-factor=1',
      "--user-data-dir=$ud",
      "--window-size=$($j.W),$($j.H)",
      "--virtual-time-budget=$($j.Budget)",
      "--screenshot=$out",
      $url
    )

    $log = & $Edge @argList 2>&1
    $rc = $LASTEXITCODE

    # Edge 有时先退出、后落盘：最多等 4 秒
    for ($i = 0; $i -lt 20 -and -not (Test-Path $out); $i++) { Start-Sleep -Milliseconds 200 }

    if (-not (Test-Path $out)) {
      throw ("第 {0} 张未落盘：{1}（Edge 退出码 {2}）`n{3}" -f $index, $j.Name, $rc, ($log -join "`n"))
    }
    $len = (Get-Item $out).Length
    if ($len -le 0) {
      throw ("第 {0} 张是 0 字节：{1}" -f $index, $j.Name)
    }
    $sz = Get-PngSize $out
    if (-not $sz -or $sz.W -ne $j.W -or $sz.H -ne $j.H) {
      throw ("第 {0} 张尺寸不符：{1} 期望 {2}×{3}，实际 {4}×{5}" -f $index, $j.Name, $j.W, $j.H, $sz.W, $sz.H)
    }

    $rows += [pscustomobject]@{
      File  = 'd74/' + $j.Name
      W     = $sz.W
      H     = $sz.H
      Bytes = $len
      Time  = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    }
    Write-Host ("[{0}/{1}] {2}  {3}×{4}  {5} B" -f $index, $Jobs.Count, $j.Name, $sz.W, $sz.H, $len) -ForegroundColor Green

    if (Test-Path $ud) { Remove-Item -Recurse -Force $ud -ErrorAction SilentlyContinue }
  }

  if ($rows.Count -ne $Jobs.Count) {
    throw ("张数不符：期望 {0}，实际 {1}" -f $Jobs.Count, $rows.Count)
  }

  # ── 清单：文件名 / 尺寸 / 字节 / 生成时间 ──────────────────────
  $lines = @(
    '# D-74 对外截图清单',
    '',
    ('生成时间：' + (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')),
    ('截图页：preflight/_shot_d73.html'),
    ('输出目录：preflight/artifacts/d74/'),
    '',
    '| 文件 | 尺寸 | 字节 | 生成时间 |',
    '| --- | --- | --- | --- |'
  )
  foreach ($r in $rows) {
    $lines += ('| {0} | {1}×{2} | {3} | {4} |' -f $r.File, $r.W, $r.H, $r.Bytes, $r.Time)
  }
  [System.IO.File]::WriteAllLines($Manifest, $lines, (New-Object System.Text.UTF8Encoding($false)))

  Write-Host ''
  $rows | Format-Table File, W, H, Bytes, Time -AutoSize | Out-String | Write-Host
  Write-Host ("SCREENSHOTS={0}/{1} OK" -f $rows.Count, $Jobs.Count) -ForegroundColor Green
  Write-Host ("MANIFEST={0}" -f $Manifest) -ForegroundColor Green
  exit 0
} catch {
  Write-Host ''
  Write-Host ('[失败] ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host '已成功的图保留在 preflight/artifacts/d74/；未覆盖 d61/、d73/。' -ForegroundColor Yellow
  exit 1
} finally {
  # 兜底清理所有遗留的临时配置目录
  Get-ChildItem $env:TEMP -Directory -Filter 'd74-shot-*' -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-Item -Recurse -Force $_.FullName -ErrorAction SilentlyContinue }
}
