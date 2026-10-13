@echo off
rem Double-click to install or update the Drone Live Stream Hub service (asks for admin rights).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1" -Pause %*
