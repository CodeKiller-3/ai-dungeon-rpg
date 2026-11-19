@echo off
chcp 936 >nul
setlocal
cd /d "%~dp0"

if not exist "index.html" (
  echo [����] �Ҳ��� index.html����ѱ��ű����ڲֿ��Ŀ¼���� index.html ͬ����
  pause
  exit /b 1
)

rem ��ȡ .html ��Ĭ�ϴ򿪷�ʽ������Ǿɰ� IE��˫�����ܰ�������ǰ����ʾ��
set "PROGID="
for /f "tokens=3" %%A in ('reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.html\UserChoice" /v ProgId 2^>nul ^| findstr /i "ProgId"') do set "PROGID=%%A"

if defined PROGID (
  echo ��ǰ .html Ĭ�ϴ򿪷�ʽ��%PROGID%
  echo %PROGID% | findstr /i "IE.HTTP htmlfile" >nul
  if not errorlevel 1 (
    echo [��ʾ] ��⵽�ɰ� IE ���������򿪺��ǿհ�ҳ�����Ҽ� index.html - �򿪷�ʽ - Microsoft Edge��
  )
) else (
  echo [��ʾ] û���� .html Ĭ�ϴ򿪷�ʽ����û���Զ��򿪣����Ҽ� index.html - �򿪷�ʽ - Microsoft Edge / Chrome��
)

echo.
echo ������Ĭ��������򿪣�%cd%\index.html
start "" "%cd%\index.html"
echo.
echo �����㹹������������������������Ҫ��װ�κζ�����
echo ����������ر����ļ������������� file:// ����ˢ�¡�
pause
