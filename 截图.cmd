@echo off
chcp 936 >nul
setlocal
cd /d "%~dp0"

echo D-74 һ����ͼ��10 �ţ�9 �� 1280x800 + 1 �� 1920x1080��
echo ���Ŀ¼��preflight\artifacts\d74\�������� d61\��d73\��
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0��ͼ.ps1"
set "RC=%ERRORLEVEL%"

echo.
if not "%RC%"=="0" (
  echo [ʧ��] ��ͼδȫ��ͨ�����˳��� %RC%���뿴����ĺ�ɫ������
) else (
  echo [���] 10 �������̣��嵥�� preflight\artifacts\d74\manifest.md
)
pause
exit /b %RC%
