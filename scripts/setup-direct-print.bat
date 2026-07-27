@echo off
rem AM Group Dashboard - Direct Print setup.
rem Double-click this on any office PC that should print dashboard documents with no dialog.
rem Optionally pass the dashboard URL:  setup-direct-print.bat https://your-dashboard-domain
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-direct-print.ps1" %*
pause
