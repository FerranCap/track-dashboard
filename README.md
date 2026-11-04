# Track Dashboard

Dashboard de operaciones alojado en GitHub Pages. No necesita Google Drive, Apps Script, base de datos ni servidor.

## Instalación

1. En https://github.com/new crea un repositorio **público** llamado `track-dashboard` (puedes elegir otro nombre). No marques "Add a README".
2. Descarga `track-github.zip` y descomprímelo.
3. Abre tu repositorio en GitHub y selecciona **Add file → Upload files**. Arrastra **el contenido** de la carpeta descomprimida, manteniendo las carpetas `data`, `scripts` y `.github`. Si la interfaz de GitHub no conserva `.github`, sube ese archivo mediante **Add file → Create new file** con el nombre `.github/workflows/update-dashboard.yml` y pega su contenido.
4. Comprueba en la pestaña **Actions** que se ejecuta `Update dashboard data` y termina correctamente. El repositorio debe permitir a GitHub Actions escribir: **Settings → Actions → General → Workflow permissions → Read and write permissions**. Guarda ese cambio si el workflow no puede hacer `git push`.
5. Activa **Settings → Pages → Build and deployment**: Source **Deploy from a branch**, Branch **main**, Folder **/(root)**, y pulsa **Save**. Si la rama principal tiene otro nombre, selecciona ese.
6. Cuando termine la publicación, abre `https://TU-USUARIO.github.io/track-dashboard/` (sustituye usuario y repositorio por los tuyos).

## Actualización diaria

Sube un CSV nuevo a la carpeta **`data/`** con **Add file → Upload files**. El workflow procesará todos los `*.csv` y actualizará `data/trades.json`. GitHub Pages actualizará el dashboard poco después. Si reemplazas un archivo, utiliza exactamente el mismo nombre.

El dashboard tiene un botón **Actualizar** que vuelve a descargar los datos publicados; no lee directamente la carpeta del repositorio.

## Duplicados y formatos

- Los CSV `quant-trades-*.csv` contienen varias filas de ejecución con el mismo `QuantTradeId`. Se agrupan para producir **una sola operación** con un único `TradePnL`.
- Se consolidan los IDs de **todos los CSV**: si vuelves a exportar un intervalo de fechas solapado, no se duplica el resultado.
- `Trades.csv` tiene otro formato (ejecuciones, sin fecha completa ni `QuantTradeId`) y **se ignora deliberadamente** hasta definir una transformación fiable. No se suma para evitar doble contabilización.
- Las fechas se muestran por día de cierre en zona horaria `America/New_York`.
- El PnL proviene directamente de `TradePnL`; no se restan comisiones otra vez porque se desconoce si ya están incorporadas.

## Privacidad

**ATENCIÓN: un repositorio público y GitHub Pages publican los CSV y el JSON procesado.** Cualquier persona con el enlace o que encuentre el repositorio puede acceder a tus operaciones. No subas datos de cuentas, identificadores personales o información financiera que quieras mantener privada. Si necesitas privacidad real, usa un despliegue autenticado en vez de GitHub Pages público.

## Probar localmente

Desde la raíz del proyecto:

```bash
python scripts/build_data.py
python -m http.server 8000
```

Abre `http://localhost:8000` en el navegador. `file://` no funciona porque el navegador bloquea `fetch` local.

## Estudios añadidos

- **Trading Statistics:** PnL, best/worst trade, profit factor, volumen diario (número de operaciones), PnL medio por acción, medias de ganadoras y perdedoras, número de días, rachas, hold time y comisiones de ejecuciones únicas.
- **Riesgo:** drawdown en la curva ordenada por hora de cierre, tamaño medio de drawdown durante los trades bajo el máximo histórico, días con drawdown, duración media de cada periodo en días operados, rachas ganadoras y perdedoras.
- **Long / Short:** estadísticas independientes, equity por operación y PnL diario; curva comparativa alineada por días operados.
- **Consistencia:** SQN = raíz(n) × media(PnL trade) / desviación estándar muestral; K-Ratio = pendiente de regresión de equity por trade / error estándar de la pendiente (convención explícita del dashboard); Kelly = winRate - lossRate / (avgWin / abs(avgLoss)); Prob. Random Chance = prueba binomial exacta bilateral con probabilidad de victoria 50%, excluyendo los trades scratch. Estas métricas son descriptivas, no predicciones ni recomendaciones.
- **Segmentación:** PnL por franjas de apertura de 30 minutos NY, precio de entrada ponderado por cantidad de ejecuciones de apertura, día de la semana de cierre y análisis de extremos por rango de fechas.

### Precisiones importantes

1. **Scratch trades** significa PnL exactamente cero (tolerancia técnica 0.000001 USD). Es una categoría excluyente respecto a ganadoras y perdedoras.
2. **Entry price y shares** se calculan agrupando las ejecuciones que tienen `Side` igual a `TradeSide`. Para un trade Short se usan las ejecuciones SELL; para Long, BUY.
3. **Total Fees** es la suma algebraica del campo `Commission`. El CSV puede contener créditos negativos; se respeta su signo. **No se resta nuevamente del PnL**, porque `TradePnL` se toma literalmente como viene del CSV.
4. **MAE/MFE** no se pueden deducir de ejecuciones sin datos de precios intratrade; se muestra **N/D**. No se inventan esas cifras.
5. **Días en drawdown** cuenta días de operaciones cuyo cierre está por debajo del anterior máximo de equity. No cuenta los días naturales sin operaciones.
6. **Biggest/average drawdown** se calcula sobre equity de operaciones cerradas, no sobre equity intradía de posiciones abiertas.
7. Las estadísticas se vuelven a calcular con los filtros globales; los periodos de drawdown y la equity **reinician desde cero** para la selección filtrada.
8. El CSV alternativo `Trades.csv` sigue excluido hasta definir una correspondencia fiable con Quant.

### Cómo actualizar los estudios

Sustituye `index.html`, `styles.css`, `dashboard.js`, `scripts/build_data.py` y `data/trades.json` en GitHub manteniendo las carpetas.
Si quieres evitar subir el JSON, sustituye los primeros cuatro archivos y ejecuta manualmente el workflow **Actions → Update dashboard data → Run workflow**. La web mostrará un aviso si se publica el JavaScript nuevo antes de regenerar el JSON.
