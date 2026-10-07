@echo off
rem Double-click to start Gift Set Studio: the app (http://127.0.0.1:3200) and the office network (http://HQ-SJ07:3200).
rem They keep running in the background after this window closes. To stop them: scripts\stop-servers.ps1
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-servers.ps1"
echo.
echo Gift Set Studio: http://127.0.0.1:3200 on this PC, http://%COMPUTERNAME%:3200 for colleagues (password in .env).
pause
