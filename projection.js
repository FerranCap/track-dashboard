'use strict';

function projectionMonth(date, months) {
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

function projectionToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function growthProjection(rows, history, startDate, interval, unit, percent, sizeMultiplier = 1, endDate = projectionMonth(startDate, 12)) {
  const endTime = Date.parse(`${endDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || !Number.isFinite(endTime)
    || new Date(endTime).toISOString().slice(0, 10) !== endDate || endDate <= startDate) {
    throw new Error('Indica una fecha final válida posterior a hoy (DD/MM/AAAA).');
  }
  if (!Number.isInteger(interval) || interval < 1 || interval > 10000
    || !['session', 'day', 'week', 'month'].includes(unit)
    || !Number.isFinite(percent) || percent < 0 || percent > 1000) {
    throw new Error('Indica una frecuencia entera entre 1 y 10.000 y una subida entre 0 y 1.000 %.');
  }
  if (!Number.isFinite(sizeMultiplier) || sizeMultiplier <= 0 || sizeMultiplier > 1000) {
    throw new Error('Indica un multiplicador de size mayor que 0 y hasta 1.000.');
  }
  const current = sessionRiskAt(startDate, history);
  if (!current) throw new Error('Falta una R vigente para iniciar la proyección.');
  const sourceSessions = new Map();
  let excluded = 0;
  for (const trade of chronologicalTrades(rows)) {
    const entryDate = trade.opened.slice(0, 10);
    const risk = sessionRiskAt(entryDate, history);
    if (!risk || !Number.isFinite(trade.pnl)) { excluded++; continue; }
    if (!sourceSessions.has(entryDate)) sourceSessions.set(entryDate, []);
    sourceSessions.get(entryDate).push({ trade, risk: risk.risk });
  }
  const sample = [...sourceSessions].sort(([left], [right]) => left.localeCompare(right)).map(([, trades]) => trades);
  const sources = sample.flat();
  const meanAbsoluteR = sources.length
    ? sources.reduce((total, source) => total + Math.abs((source.trade.pnlUsd ?? source.trade.pnl) / source.risk), 0) / sources.length
    : null;
  const points = [[startDate, current.risk]], trades = [];
  let session = 0, projectedRisk = current.risk;
  const startTime = Date.parse(`${startDate}T00:00:00Z`);
  for (let time = startTime + 86400000; time <= endTime; time += 86400000) {
    const date = new Date(time).toISOString().slice(0, 10);
    const weekday = new Date(time).getUTCDay();
    const tradingDay = weekday !== 0 && weekday !== 6;
    let increases = 0;
    if (unit === 'session') {
      if (!tradingDay) continue;
      increases = Math.floor(session / interval);
    } else if (unit === 'month') {
      const months = (Number(date.slice(0, 4)) - Number(startDate.slice(0, 4))) * 12 + Number(date.slice(5, 7)) - Number(startDate.slice(5, 7));
      increases = Math.floor(months / interval);
      if (date < projectionMonth(startDate, increases * interval)) increases--;
    } else {
      increases = Math.floor((time - startTime) / (86400000 * interval * (unit === 'week' ? 7 : 1)));
    }
    const risk = current.risk * (1 + percent / 100) ** increases;
    if (!Number.isFinite(risk)) throw new Error('La combinación de frecuencia y porcentaje supera el rango calculable. Reduce la subida.');
    if (risk !== projectedRisk) points.push([date, risk]);
    projectedRisk = risk;
    if (!tradingDay) continue;
    if (sample.length) {
      for (const source of sample[session % sample.length]) {
        const sourcePnl = source.trade.pnlUsd ?? source.trade.pnl;
        const pnl = sourcePnl / source.risk * risk * sizeMultiplier;
        const averagePnl = meanAbsoluteR * risk * sizeMultiplier;
        if (!Number.isFinite(pnl) || !Number.isFinite(averagePnl)) throw new Error('La proyección supera el rango calculable. Reduce la subida.');
        trades.push({ id: `projection-${date}-${source.trade.id}`, symbol: source.trade.symbol,
          date, opened: date, closed: date, pnl, averagePnl, projectedRisk: risk, projectionOrder: trades.length,
          sourceDate: source.trade.opened.slice(0, 10), sourcePnl, sourceRisk: source.risk });
      }
    }
    session++;
  }
  if (points.at(-1)[0] !== endDate) points.push([endDate, projectedRisk]);
  return { points, trades, excluded, sourceSessions: sample.length, sourceTrades: sources.length, meanAbsoluteR,
    sessions: session, endDate, initialRisk: current.risk, finalRisk: projectedRisk };
}

function renderGrowthProjection(rows) {
  const intervalInput = $('growth-projection-interval'), percentInput = $('growth-projection-percent');
  const interval = intervalInput.value.trim() ? Number(intervalInput.value) : NaN;
  const percent = percentInput.value.trim() ? Number(percentInput.value) : NaN;
  const unit = $('growth-projection-unit').value;
  const sizeInput = $('growth-projection-size');
  const sizeMultiplier = sizeInput.value.trim() ? Number(sizeInput.value) : NaN;
  const today = projectionToday();
  const endInput = $('growth-projection-end');
  const endDate = dateFieldToIso(endInput.value);
  endInput.setAttribute('aria-invalid', String(!endDate || endDate <= today));
  let projection = null, message = '';
  try { projection = growthProjection(rows, sessionRiskHistory, today, interval, unit, percent, sizeMultiplier, endDate); }
  catch (error) { message = error.message; }
  const trades = projection?.trades || [];
  const displayTrades = displayPnlRows(trades.map(trade => ({ ...trade, pnl: trade.averagePnl })));
  const explanation = `Escenario desde ${today} hasta ${projection?.endDate || endDate || "la fecha elegida"}, partiendo de la R actual. Subidas de R compuestas. PnL proyectado = PnL histórico / R histórica × R proyectada × size ${num(sizeMultiplier)}. El multiplicador escala ganancias, pérdidas y costes ya incluidos en el PnL de forma proporcional; la ejecución y los costes reales pueden variar. Se repite la secuencia histórica filtrada. Sesiones de lunes a viernes sin descontar festivos bursátiles. Se excluyen trades sin R conocida en su entrada. Las sesiones continúan aunque alcancen −R; no se simula detener la operativa.`;
  const units = { session: 'sesiones', day: 'días', week: 'semanas', month: 'meses' };
  $('growth-projection-status').textContent = projection
    ? `Desde ${today} hasta ${projection.endDate}. R inicial ${usdMoney(projection.initialRisk)} → R final ${usdMoney(projection.finalRisk)}. Subida del ${num(percent, 1)} % cada ${interval} ${units[unit]}. Size ×${num(sizeMultiplier)}. ${projection.sourceSessions} sesiones históricas como base; ${projection.sessions} sesiones futuras de lunes a viernes. ${projection.excluded} trades excluidos por falta de R o PnL válido.${!projection.sourceSessions ? ' Sin muestra disponible para proyectar el PnL.' : ''}`
    : message;
  const empty = message || 'Sin operaciones con R conocida para proyectar.';
  const averageExplanation = `Media base = media de |PnL USD / R histórica| de todos los trades que pasan el filtro general y tienen R conocida, incluidos los ceros. Cada trade pesa lo mismo. Se calcula antes de limitar las operaciones visibles o agrupar por período. Magnitud en USD = media base × size ${num(sizeMultiplier)} × R proyectada; en R = media base × size. En R permanece constante; en USD refleja la evolución de R. Las agrupaciones muestran la media por trade de cada período. Escenario desde ${today} hasta ${projection?.endDate || endDate || 'la fecha elegida'}. Se conserva la secuencia histórica de cantidades de trades por sesión, de lunes a viernes sin descontar festivos bursátiles.`;
  $('growth-projection-average-base').textContent = projection?.meanAbsoluteR != null
    ? `Media base del filtro general: ${num(projection.meanAbsoluteR, 4)} R por trade (${projection.sourceTrades} trades, incluidos los ceros). Con size ×${num(sizeMultiplier)}: ${num(projection.meanAbsoluteR * sizeMultiplier, 4)} R por trade. En USD se multiplica por la R de cada sesión proyectada.`
    : empty;
  renderSessionSwings(trades, true, message);
  renderChart('growth-projection-risk-chart', [{ values: projection?.points || [], color: '#b398ff' }], {
    currency: true, currencyUnit: 'usd', step: true, timeAxis: true, title: 'Evolución proyectada de R', explanation, empty
  });
  const points = growthTradePoints(displayTrades, $('growth-projection-trade-window').value);
  $('growth-projection-trade-count').textContent = points.length
    ? `Trades proyectados ${points[0].number}–${points.at(-1).number} de ${trades.length}. Cada barra muestra la misma media base escalada por la R proyectada y el size.`
    : 'Sin operaciones proyectadas.';
  renderChart('growth-projection-absolute-pnl-chart', [{ color: '#b398ff', values: points.map(({ trade, number, absolute }) => [
    `Trade medio proyectado #${number} · ${trade.date}`, absolute,
    `Media base: ${num(projection.meanAbsoluteR, 4)} R. Size ×${num(sizeMultiplier)}. R proyectada: ${usdMoney(trade.projectedRisk)}. Magnitud media: ${usdMoney(trade.averagePnl)}.`
  ]) }], { currency: true, bar: true, labels: points.map(point => `#${point.number}`), title: 'Evolución del PnL absoluto medio por trade', explanation: averageExplanation, empty });
  const selected = $('growth-projection-average-period').value;
  const periods = growthPeriods(displayTrades, ['day', 'week', 'month'].includes(selected) ? selected : 'week');
  renderChart('growth-projection-average-pnl-chart', [{ color: '#b398ff', values: periods.map(period => [period.period, period.meanAbsolutePnl]) }], {
    currency: true, bar: true, title: 'PnL absoluto medio proyectado por período', explanation: `Semanas de lunes a domingo. ${averageExplanation}`, empty
  });
}

function initializeGrowthProjection() {
  const endInput = $('growth-projection-end');
  endInput.value = dateFieldFromIso(projectionMonth(projectionToday(), 12));
  attachDatePicker(endInput);
  for (const id of ['growth-projection-end', 'growth-projection-interval', 'growth-projection-percent', 'growth-projection-size']) {
    $(id).addEventListener('input', () => renderGrowthProjection(filtered));
  }
  for (const id of ['growth-projection-unit', 'growth-projection-trade-window', 'growth-projection-average-period', 'growth-projection-swing-unit']) {
    $(id).addEventListener('change', () => renderGrowthProjection(filtered));
  }
  $('growth-swing-unit').addEventListener('change', () => renderSessionSwings(filtered));
}
