# Track Dashboard

Dashboard de trading para GitHub Pages. Construye `data/trades.json` desde los CSV de `data/` en cada publicación.

## Instalación con GitHub Desktop

1. Descarga el ZIP y descomprímelo.
2. En GitHub Desktop, abre el repositorio `track-dashboard`: **Repository > Show in Explorer**.
3. Copia **el contenido** de esta carpeta descomprimida en la carpeta del repositorio (la que ya contiene `.git`). No copies ni borres `.git`.
4. Confirma que aparecen `.github/workflows/update-dashboard.yml`, `data/*.csv`, `scripts/*.py`, `index.html`, `dashboard.js`, `styles.css`.
5. En GitHub Desktop, revisa los cambios, escribe `Restore complete dashboard` y pulsa **Commit to main** y **Push origin**.
6. En GitHub.com, abre **Settings > Pages > Build and deployment**, selecciona **Source: GitHub Actions**. Este proyecto despliega mediante Actions; **no uses Deploy from a branch**.
7. En la pestaña **Actions**, comprueba la ejecución **Build and deploy Track Dashboard**. Si es la primera vez, puedes abrirla y pulsar **Run workflow**.
8. Abre `https://FerranCap.github.io/track-dashboard/` y comprueba que muestra **Versión: 20261104-fullfix-1** y **Datos cargados**. Si hay un error, revisa la consola con F12.

## Actualización diaria

Copia los nuevos exportes CSV a `data/`, confirma los cambios con GitHub Desktop y pulsa **Push origin**. La acción leerá los CSV y desplegará la web con el JSON generado. No edites `data/trades.json` a mano. También puedes ejecutar `python scripts/build_data.py` para regenerarlo localmente.

## Formatos y precisión

- Solo se procesan CSV Quant con `QuantTradeId` y el resto de campos requeridos. CSV de broker con otras columnas quedan excluidos.
- Los trades se agrupan por `QuantTradeId` y las ejecuciones repetidas entre exportes se deduplican según los campos disponibles. Cuando haya ejecuciones perfectamente idénticas no diferenciables, se conserva su multiplicidad dentro de cada exportación.
- El `TradePnL` se toma literalmente del CSV; las comisiones no se descuentan de nuevo.
- MAE/MFE no son calculables sin el recorrido de precios de la posición.
- La fecha de los trades se presenta en hora de Nueva York.

## Privacidad

**La configuración estándar de GitHub Pages es pública.** Los CSV del repositorio y los datos publicados quedan expuestos si el repositorio es público. Evita subir identificadores de cuenta o datos sensibles.

## Prueba local

```bash
python scripts/build_data.py
python -m unittest discover -s scripts -p 'test_*.py'
python -m http.server 8000
```

Abre `http://localhost:8000` (no abras `index.html` mediante `file://`).
