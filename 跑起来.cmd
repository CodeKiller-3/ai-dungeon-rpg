@echo off
chcp 936 >nul
setlocal
cd /d "%~dp0"

if not exist "index.html" (
  echo [错误] 找不到 index.html：请把本脚本放在仓库根目录，和 index.html 同级。
  pause
  exit /b 1
)

rem 读取 .html 的默认打开方式；如果是旧版 IE，双击可能白屏，提前给提示。
set "PROGID="
for /f "tokens=3" %%A in ('reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.html\UserChoice" /v ProgId 2^>nul ^| findstr /i "ProgId"') do set "PROGID=%%A"

if defined PROGID (
  echo 当前 .html 默认打开方式：%PROGID%
  echo %PROGID% | findstr /i "IE.HTTP htmlfile" >nul
  if not errorlevel 1 (
    echo [提示] 检测到旧版 IE 关联。若打开后是空白页，请右键 index.html - 打开方式 - Microsoft Edge。
  )
) else (
  echo [提示] 没读到 .html 默认打开方式；若没有自动打开，请右键 index.html - 打开方式 - Microsoft Edge / Chrome。
)

echo.
echo 正在用默认浏览器打开：%cd%\index.html
start "" "%cd%\index.html"
echo.
echo 本作零构建、零依赖、不联网，不需要安装任何东西。
echo 若浏览器拦截本地文件，请允许访问 file:// 后再刷新。
pause
