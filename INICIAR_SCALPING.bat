@echo off
cd /d "%~dp0"
start "Tanatabot Scalping" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-scalping.ps1"
