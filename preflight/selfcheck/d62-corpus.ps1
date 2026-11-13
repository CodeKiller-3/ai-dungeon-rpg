# D-62：生成全仓文本语料，供 verify_d60（D-62 扩展版）的 A 组一次读取后逐文件扫描。
# 为什么不是 300+ 次同步 XHR：Chrome 的 --virtual-time-budget 下每次 file:// 同步
# 请求约 15ms，串行读完会被预算截断（D-60 实测停在 3.1s，页面一直 RUNNING）。
# 语料在提交前重新生成；verify_d60 另外实时复核 13 个高危文件。
param([string]$Root = '')
$ErrorActionPreference = 'Stop'
if (-not $Root) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
  $Root = (Resolve-Path (Join-Path $here '..\..')).Path
}
$exts = @('.md', '.html', '.js', '.css', '.ps1')
$files = Get-ChildItem -LiteralPath $Root -Recurse -File | Where-Object {
  $_.FullName -notmatch '\\\.git\\' -and $exts -contains $_.Extension.ToLower()
} | Sort-Object FullName
$sb = New-Object System.Text.StringBuilder
foreach ($f in $files) {
  $rel = $f.FullName.Substring($Root.Length + 1) -replace '\\', '/'
  [void]$sb.Append('@@D62FILE@@ ' + $rel + "`n")
  $text = [IO.File]::ReadAllText($f.FullName, [Text.Encoding]::UTF8)
  [void]$sb.Append($text.Replace("`r`n", "`n"))
  [void]$sb.Append("`n")
}
$out = Join-Path $PSScriptRoot 'd62-corpus.txt'
[IO.File]::WriteAllText($out, $sb.ToString(), (New-Object Text.UTF8Encoding($false)))
Write-Output ("files=" + $files.Count + " bytes=" + (Get-Item $out).Length + " -> " + $out)
