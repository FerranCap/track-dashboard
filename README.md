# Track Dashboard

[Abrir la web de Track Dashboard](https://FerranCap.github.io/track-dashboard/)

Dashboard de trading para GitHub Pages. Construye `data/trades.json` desde los CSV de `data/` en cada publicación.

## Instalación con GitHub Desktop

1. Descarga el ZIP y descomprímelo.
2. En GitHub Desktop, abre el repositorio `track-dashboard`: **Repository > Show in Explorer**.
3. Copia **el contenido** de esta carpeta descomprimida en la carpeta del repositorio (la que ya contiene `.git`). No copies ni borres `.git`.
4. Confirma que aparecen `.github/workflows/update-dashboard.yml`, `data/*.csv`, `scripts/*.py`, `index.html`, `dashboard.js`, `styles.css`.
5. En GitHub Desktop, revisa los cambios, escribe `Restore complete dashboard` y pulsa **Commit to main** y **Push origin**.
6. En GitHub.com, abre **Settings > Pages > Build and deployment**, selecciona **Source: GitHub Actions**. Este proyecto despliega mediante Actions; **no uses Deploy from a branch**.
7. En la pestaña **Actions**, comprueba la ejecución **Build and deploy Track Dashboard**. Si es la primera vez, puedes abrirla y pulsar **Run workflow**.
8. Abre `https://FerranCap.github.io/track-dashboard/` y comprueba que muestra **Versión: 20261105-data-audit-6** y **Datos cargados**. Si hay un error, revisa la consola con F12.

## Actualización diaria

Copia los nuevos exportes CSV a `data/`, confirma los cambios con GitHub Desktop y pulsa **Push origin**. La acción leerá los CSV y desplegará la web con el JSON generado. No edites `data/trades.json` a mano. También puedes ejecutar `python scripts/build_data.py` para regenerarlo localmente.

## Formatos y precisión

Para actualizar desde el chat, adjunta el CSV diario y escribe **«Actualiza los trades»**. El procedimiento está definido en [AGENTS.md](AGENTS.md): detectar el formato, convertirlo si hace falta, aplicar el criterio de comisiones acordado, comprobar duplicados, regenerar los datos y validar el resultado. Un archivo enviado solo para comparar formatos no se importa.

Si aparecen tickers nuevos, se investigan y se completa su ficha con fuentes oficiales. Al terminar se informa de cada ticker, los valores añadidos y los campos que sigan sin confirmar, para que puedas revisar y corregir la clasificación. Los campos inciertos no se inventan y siguen pendientes en Tickers.

País, Análisis, Ratios y concentración de resultados usan exclusivamente el país de constitución. Un ticker solo cuenta como sin identificar si falta ese país. La jurisdicción detallada, país de operación, sede, tipo de valor y VIE se conservan en las fichas de Tickers como información adicional, sin afectar a los análisis ni a la identificación. No se usan sustituciones por sede, operación ni Soft data.

El `Trades.csv` del broker del 2026-11-05 se ha convertido a `data/quant-trades-broker-2026-11-05.csv`: 129 ejecuciones agrupadas en 8 ciclos de posición cerrados, con horarios de Nueva York. `TradePnL` suma el `P / L` reportado y el `ECNFee` firmado; `Commission` contiene el coste ECN con signo de gasto. Solo se incluyen los costes disponibles en ese archivo, sin inventar otras comisiones. Los campos `ReportedExecutionPnL`, `ECNFee` y `PnLBasis` permiten auditar la conversión. No se copia la cuenta del broker. El Excel de marzo no se ha añadido.

`scripts/import_broker_trades.py` permite repetir la conversión con fecha y criterio de PnL explícitos; rechaza posiciones incompletas, reversiones sin desglosar y solapamientos con operaciones Quant existentes.

- Solo se procesan CSV Quant con `QuantTradeId` y el resto de campos requeridos. CSV de broker con otras columnas quedan excluidos.
- Los trades se agrupan por `QuantTradeId` y las ejecuciones repetidas entre exportes se deduplican según los campos disponibles. Cuando haya ejecuciones perfectamente idénticas no diferenciables, se conserva su multiplicidad dentro de cada exportación.
- El `TradePnL` se toma literalmente del CSV; las comisiones no se descuentan de nuevo.
- MAE/MFE no son calculables sin el recorrido de precios de la posición.
- La fecha de los trades se presenta en hora de Nueva York.

## Apartados de estudio

Las tarjetas, gráficos, tablas y filtros incluyen ayudas al pasar el ratón o enfocarlos con el teclado. En móvil, toca el elemento para consultar la explicación; vuelve a tocarlo o toca fuera para cerrarla. Escape cierra la ayuda. Las barras de Ratios incluyen los valores concretos usados en el cálculo; «x» indica veces, «%» porcentaje y «pp» puntos porcentuales.

El menú lateral muestra diez vistas: General, Calendario, Comparativas, Análisis, Crecimiento, Ratios, Riesgo y consistencia, País, Tickers y Operaciones. Los filtros globales se mantienen al cambiar de apartado. Cada vista tiene un enlace directo, por ejemplo `#ratios`.

En País, **Comprobar tickers pendientes** recarga los últimos datos publicados y abre **Tickers**. La comprobación también se actualiza al cargar la web. Tickers contrasta todo el historial con la base de emisores, sin aplicar los filtros globales. Cuenta como identificados los tickers con país de constitución y lista los que carecen de ese dato, con búsqueda, número de operaciones y primera/última fecha. Las fichas completas, sus datos adicionales y el CSV descargable están en esta misma pestaña. Los nuevos CSV deben haberse publicado mediante GitHub Actions para que aparezcan en el historial de la web.

- Calendario permite cambiar de mes y seleccionar una sesión desde el calendario principal o un panel lateral de seis meses. Cada tarjeta de ticker muestra sus operaciones, ganadoras/perdedoras/a cero, win rate, PnL, comisiones informativas, profit factor, Long/Short y curva acumulada, calculados solo con sus trades de ese día. El resumen diario conserva las mismas métricas para el conjunto de tickers, además de la tabla de trades. Los importes usan el PnL del historial sin volver a descontar comisiones. No incluye valoraciones A++ ni enlaces a gráficos de ejecuciones. En pantallas pequeñas el panel de meses se coloca debajo del calendario principal.
- Crecimiento muestra beneficio acumulado y mensual, PnL medio con signo, media y mediana de |PnL| por trade y variaciones en USD frente al mes anterior observado. El valor absoluto se calcula por trade antes de promediar; no se divide por precio ni por shares. Los datos se agrupan por mes de cierre y respetan los filtros. No se calcula rentabilidad de la cuenta ni recorrido intratrade.
- Análisis separa horario, símbolos, precio, duración y long/short mediante pestañas.
- Comparativas cruza los filtros globales con los de cada grupo: fechas, dirección y símbolo. Por defecto compara long frente a short; los grupos pueden solaparse.
- Ratios distingue la relación ganancia/pérdida realizada del Risk/Reward planificado. Este último no se calcula sin stop y objetivo iniciales.
- Ratios incluye estudios de win rate y RR realizado por horario de entrada (5 minutos por defecto; también 30 o 60 minutos, Nueva York) y por país, con mínimo de operaciones configurable. Las tablas muestran el tamaño de muestra, operaciones a cero, medias, profit factor y esperanza. El RR queda sin valor cuando falta una operación ganadora o perdedora; el win rate incluye las operaciones a cero.

País consulta la [base de emisores](data/reference/ticker-profiles.csv) y agrupa los resultados por país de constitución. Tickers conserva las fichas y fuentes oficiales, con una fila por símbolo. La base es una instantánea de investigación, no una reconstrucción de todas las reorganizaciones históricas.

La [metodología y los campos](data/reference/README.md) explican los estados de verificación y cómo actualizar las fuentes. GitHub Actions reutiliza la base local; no investiga ni modifica países automáticamente en cada publicación. `data/symbol-countries.json` queda como compatibilidad para símbolos sin ficha en la base; nunca sustituye un estado pendiente de una ficha existente.

## Consistency study calculations

The Risk and Consistency view includes eight studies, all scoped to the active filters:

- Rolling win rate, profit factor and mean PnL use complete windows of 25, 50 and 100 trades sorted by closing timestamp. Overlapping windows are not independent samples.
- Positive weeks and months use New York closing dates and only periods containing trades. Weeks start on Monday. Boundary periods may be incomplete; inactive periods are omitted from negative-period streaks.
- Winner dependence removes the best 1, 5 or 10 winning trades and recalculates PnL and profit factor. Concentration uses total positive trade PnL as its denominator.
- Recovery episodes start at the last equity high, with an initial reference of zero. Completed episodes include the recovery trade. Calendar days and trade counts are reported separately; the open episode is excluded from completed-recovery averages.
- Monthly mean PnL compares each month's PnL divided by its trade count, alongside monthly win rate and profit factor.
- Group concentration supports symbols, incorporation countries, five-minute entry bands and closing weekdays. Weight is positive group PnL divided by the sum of positive group PnLs. Only a missing incorporation country creates an unclassified group.
- Post-loss behavior uses the most recent trade already closed at entry time. Overlapping positions do not reveal future results. Share averages exclude missing quantities; waiting times include overnight gaps and use the median. This is an association study, not a causal or monetary-risk model.
- Resampling draws historical sessions with replacement for 500 paths of 25, 50, 100 or 250 trades, preserving within-session order and trimming the final block. It starts from zero using recorded dollar PnL, without compounding or position resizing. A deterministic seed makes results repeatable. Pointwise P5/P50/P95 lines are not individual paths or confidence intervals. The method ignores dependence between sessions and cannot represent losses absent from the source history. The basic resampling-with-replacement principle is described in the [SciPy bootstrap documentation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html); this dashboard uses its own session-based scenario calculation, not SciPy confidence intervals.

`node scripts/test_consistency.js` checks calculation fixtures. The Python test suite also runs this check when Node is available.

## Privacidad

**La configuración estándar de GitHub Pages es pública.** Los CSV del repositorio y los datos publicados quedan expuestos si el repositorio es público. Evita subir identificadores de cuenta o datos sensibles.

## Prueba local

```bash
python scripts/build_data.py
python -m unittest discover -s scripts -p 'test_*.py'
python -m http.server 8000
```

Abre `http://localhost:8000` (no abras `index.html` mediante `file://`).

En Windows, si Python no encuentra `America/New_York`, instala la base de zonas horarias con `python -m pip install tzdata`.
