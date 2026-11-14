@echo off
chcp 936 >nul
setlocal
cd /d "%~dp0"

echo D-74 一键截图：10 张（9 张 1280x800 + 1 张 1920x1080）
echo 输出目录：preflight\artifacts\d74\（不覆盖 d61\、d73\）
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0截图.ps1"
set "RC=%ERRORLEVEL%"

echo.
if not "%RC%"=="0" (
  echo [失败] 截图未全部通过，退出码 %RC%。请看上面的红色报错。
) else (
  echo [完成] 10 张已落盘，清单在 preflight\artifacts\d74\manifest.md
)
pause
exit /b %RC%
