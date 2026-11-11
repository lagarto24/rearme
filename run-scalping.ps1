# Ejecuta el bot de scalping en este ordenador: una pasada al arrancar y luego cada hora (minuto 2).
# El ordenador debe quedarse encendido. Lo arranca INICIAR_SCALPING.bat. Registro en scalp.log.
$dir = $PSScriptRoot
$bun = Join-Path $env:USERPROFILE ".bun\bin\bun.exe"
Set-Location $dir
"=== $(Get-Date) arrancando bot de scalping ===" | Out-File scalp.log -Append -Encoding utf8
while ($true) {
    cmd.exe /c "`"$bun`" scalp.ts --once >> scalp.log 2>&1"
    $now = Get-Date
    $next = $now.Date.AddHours($now.Hour + 1).AddMinutes(2)
    Start-Sleep -Seconds ([int][Math]::Max(60, ($next - $now).TotalSeconds))
}
