@echo off
cd /d "%~dp0"
echo Enviando un resumen de prueba al grupo de scalping...
"%USERPROFILE%\.bun\bin\bun.exe" scalp.ts --summary
echo.
echo Listo. Ya puedes cerrar esta ventana.
pause
