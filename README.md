# Tanatabot Scalping (aparte del bot de señales diarias)

Bot de señales de corto plazo para cripto. **Solo envía estrategias probadas con costes reales.**

## Qué se probó (`lab.ts` → `lab_resultados.txt`, `lab_resultados_2.txt`, `lab_resultados_top20.txt`)
- 7 estrategias × LONG/SHORT en velas de **15 min** y **1 h**: 10 criptos (1–3 años) y 12 acciones (2 años, 1 h).
- Costes: 0,14 % ida y vuelta (comisión taker de Backpack/Hyperliquid + deslizamiento).
- Para aprobar: ≥100 operaciones, PF ≥ 1,15, datos no vistos PF ≥ 1,1, costes dobles PF ≥ 1, sin el 5 % mejores > 0, sensibilidad ±20 %.
- **Resultado: ninguna aprueba todo.** En 15 min pierden todas. Lo más cerca: ruptura Donchian 20 LONG en 1 h (PF 1,21; datos no vistos 1,28),
  que solo falla la prueba de depender de sus mejores operaciones. Por eso se envía **EN PRUEBA, con mitad de tamaño**.
- **Plan top 50** (`lab_top50.ts` → `lab_resultados_top50.txt`): 50 primeras criptos del ranking que se pueden operar.
  - Puestos 1–25 con señal **clara** (volumen ≥ 1,5× y ADX ≥ 25): ~92 señales/mes, PF 1,25, datos no vistos 1,38, costes dobles 1,10. **Se envían.**
  - Puestos 26–50: ninguna versión gana (PF ~1,02 incluso solo con señales claras). **No se envían**: se vigilan en papel y salen en el resumen.

## Cómo funciona `scalp.ts`
- Cada hora revisa las 50 criptos. Señal: cierre sobre el máximo de 20 velas y sobre la EMA200, con volumen ≥ 1,5× la media y ADX ≥ 25.
- Stop inicial 2 × ATR; después sube al mínimo de las últimas 10 velas. Al tocarlo envía un mensaje corto: **CERRAR POSICIÓN**.
- El socio del proyecto (ID 936234915) recibe por privado lo mismo que el grupo.
- Resumen cada domingo a las 19:00 (enviadas + vigilancia 26–50). Sin grupo configurado funciona en **modo papel** (registra, no envía).
- `bun scalp.ts --dry` (prueba sin enviar) · `bun scalp.ts --replay` (verificación: debe dar lo mismo que el laboratorio).

## En marcha
- **En la nube, en su propio repositorio de GitHub** (`lagarto24/rearme`, aparte de Tanatabot): `.github/workflows/scalping.yml`
  revisa cada 5 minutos (ejecuciones encadenadas, como Tanatabot) aunque el ordenador esté apagado y envía al grupo "Tanatabot Scalping". Secreto: `TELEGRAM_BOT_TOKEN`.
  Estado en `estado_nube.json`. Para subir cambios: doble clic en `SUBIR_A_GITHUB.bat`.
- En este ordenador queda el laboratorio. `scalp_config.json` está vacío a propósito: si se ejecuta aquí (`INICIAR_SCALPING.bat`),
  funciona en modo papel y no duplica las señales de la nube.
