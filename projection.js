'use strict';

function projectionMonth(date, months) {
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

function growthProjection(rows, history, startDate, interval, unit, percent) {
  if (!Number.isInteger(interval) || interval < 1 || interval > 10000
    || !['session', 'day', 'week', 'month'].includes(unit)
    || !Number.isFinite(percent) || percent < 0 || percent > 1000) {
    throw new Error('Indica una frecuencia entera entre 1 y 10.000 y una subida entre 0 y 1.000 %.');
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
  const endDate = projectionMonth(startDate, 12);
  const points = [[startDate, current.risk]], trades = [];
  let session = 0, projectedRisk = current.risk;
  const startTime = Date.parse(`${startDate}T00:00:00Z`);
  for (let time = startTime + 86400000; time <= Date.parse(`${endDate}T00:00:00Z`); time += 86400000) {
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
        const pnl = source.trade.pnl / source.risk * risk;
        if (!Number.isFinite(pnl)) throw new Error('La proyección supera el rango calculable. Reduce la subida.');
        trades.push({ id: `projection-${date}-${source.trade.id}`, symbol: source.trade.symbol,
          date, opened: date, closed: date, pnl, projectedRisk: risk,
          sourceDate: source.trade.opened.slice(0, 10), sourcePnl: source.trade.pnl, sourceRisk: source.risk });
      }
    }
    session++;
  }
  if (points.at(-1)[0] !== endDate) points.push([endDate, projectedRisk]);
  return { points, trades, excluded, sourceSessions: sample.length, sessions: session, endDate, initialRisk: current.risk, finalRisk: projectedRisk };
}

function renderGrowthProjection(rows) {
  const intervalInput = $('growth-projection-interval'), percentInput = $('growth-projection-percent');
  const interval = intervalInput.value.trim() ? Number(intervalInput.value) : NaN;
  const percent = percentInput.value.trim() ? Number(percentInput.value) : NaN;
  const unit = $('growth-projection-unit').value;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  let projection = null, message = '';
  try { projection = growthProjection(rows, sessionRiskHistory, today, interval, unit, percent); }
  catch (error) { message = error.message; }
  const trades = projection?.trades || [];
  const explanation = 'Escenario a 12 meses desde la R actual. Las subidas son compuestas. Cada trade proyectado conserva el PnL/R de su operación histórica y lo multiplica por la R proyectada de su sesión. Se repite en orden la secuencia de sesiones históricas filtradas. Las sesiones futuras se sitúan de lunes a viernes, sin descontar festivos bursátiles. Se excluyen trades sin R conocida en su fecha de entrada. No modifica los resultados reales.';
  const units = { session: 'sesiones', day: 'días', week: 'semanas', month: 'meses' };
  $('growth-projection-status').textContent = projection
    ? `Desde ${today} hasta ${projection.endDate}. R inicial ${money(projection.initialRisk)} → R final ${money(projection.finalRisk)}. Subida del ${num(percent, 1)} % cada ${interval} ${units[unit]}. ${projection.sourceSessions} sesiones históricas como base; ${projection.sessions} sesiones futuras de lunes a viernes. ${projection.excluded} trades excluidos por falta de R o PnL válido.${!projection.sourceSessions ? ' Sin muestra disponible para proyectar el PnL.' : ''}`
    : message;
  const empty = message || 'Sin operaciones con R conocida para proyectar.';
  renderChart('growth-projection-risk-chart', [{ values: projection?.points || [], color: '#b398ff' }], {
    currency: true, step: true, timeAxis: true, title: 'Evolución proyectada de R', explanation, empty
  });
  const points = growthTradePoints(trades, $('growth-projection-trade-window').value);
  $('growth-projection-trade-count').textContent = points.length
    ? `Trades proyectados ${points[0].number}–${points.at(-1).number} de ${trades.length}. Una barra por operación simulada.`
    : 'Sin operaciones proyectadas.';
  $('growth-projection-absolute-pnl-chart').style.minWidth = points.length ? `${Math.max(300, points.length * 9 + 100)}px` : '0';
  renderChart('growth-projection-absolute-pnl-chart', [{ color: '#b398ff', values: points.map(({ trade, number, absolute }) => [
    `Trade proyectado #${number} · ${trade.symbol} · ${trade.date}`, absolute,
    `R proyectada: ${money(trade.projectedRisk)}. Base histórica: ${trade.sourceDate}, PnL ${signed(trade.sourcePnl)}, R ${money(trade.sourceRisk)}.`
  ]) }], { currency: true, bar: true, labels: points.map(point => `#${point.number}`), title: 'PnL absoluto proyectado por trade', explanation, empty });
  const selected = $('growth-projection-average-period').value;
  const periods = growthPeriods(trades, ['day', 'week', 'month'].includes(selected) ? selected : 'week');
  renderChart('growth-projection-average-pnl-chart', [{ color: '#b398ff', values: periods.map(period => [period.period, period.meanAbsolutePnl]) }], {
    currency: true, bar: true, title: 'PnL absoluto medio proyectado por trade', explanation: `Media de |PnL proyectado| por período, incluidos los ceros. Semanas de lunes a domingo. ${explanation}`, empty
  });
}

function initializeGrowthProjection() {
  for (const id of ['growth-projection-interval', 'growth-projection-percent']) {
    $(id).addEventListener('input', () => renderGrowthProjection(filtered));
  }
  for (const id of ['growth-projection-unit', 'growth-projection-trade-window', 'growth-projection-average-period']) {
    $(id).addEventListener('change', () => renderGrowthProjection(filtered));
  }
}
