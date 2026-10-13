@echo off
rem Double-click to remove the Drone Live Stream Hub service (keeps config and logs).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-windows.ps1" -Pause %*
