@echo off
cd /d "%~dp0"
echo Subiendo el bot de scalping a su repositorio de GitHub...
set G=git -c safe.directory=*
if not exist estado_nube.json curl -s -L -o estado_nube.json https://raw.githubusercontent.com/lagarto24/tanatabot-senales/main/scalping/scalp_state.json
%G% config user.email >nul 2>&1 || %G% config user.email "tanatabot@users.noreply.github.com"
%G% config user.name >nul 2>&1 || %G% config user.name "tanatabot"
%G% remote get-url origin >nul 2>&1 || %G% remote add origin https://github.com/lagarto24/rearme.git
%G% add -A
%G% commit -m "Bot de scalping"
%G% branch -M main
%G% pull --rebase --autostash origin main 2>nul
%G% push -u origin main
echo.
echo Listo. Ya puedes cerrar esta ventana.
pause
