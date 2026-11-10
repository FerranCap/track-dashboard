'use strict';

function sessionSwings(rows, history, projected = false) {
  const groups = new Map();
  for (const trade of chronologicalTrades(rows)) {
    const date = trade.date;
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(trade);
  }
  const sessions = [];
  let excludedSessions = 0;
  for (const [date, trades] of [...groups].sort(([left], [right]) => left.localeCompare(right))) {
    const risk = projected ? trades[0].projectedRisk : sessionRiskAt(date, history)?.risk;
    if (!Number.isFinite(risk) || risk <= 0 || trades.some(trade => !Number.isFinite(trade.pnl))) {
      excludedSessions++;
      continue;
    }
    const closes = new Map();
    let invalidClose = false;
    for (const trade of trades) {
      const key = projected ? trade.projectionOrder : Date.parse(trade.closed);
      if (!Number.isFinite(key)) { invalidClose = true; break; }
      closes.set(key, (closes.get(key) || 0) + (trade.pnlUsd ?? trade.pnl));
    }
    if (invalidClose || !closes.size) { excludedSessions++; continue; }
    let pnl = 0, minimum = 0, maximum = 0;
    for (const [, value] of [...closes].sort(([left], [right]) => left - right)) {
      pnl += value;
      minimum = Math.min(minimum, pnl);
      maximum = Math.max(maximum, pnl);
    }
    if (![pnl, minimum, maximum, maximum - minimum].every(Number.isFinite)) {
      excludedSessions++;
      continue;
    }
    sessions.push({ date, risk, minimum, maximum, pnl, count: trades.length,
      swing: maximum - minimum, lossR: -minimum / risk,
      reachedStop: minimum <= -risk + risk * 1e-9 });
  }
  const reached = sessions.filter(session => session.reachedStop).length;
  return { sessions, excludedSessions, reached,
    reachedPercent: sessions.length ? reached / sessions.length * 100 : null,
    maximumLossR: sessions.length ? Math.max(...sessions.map(session => session.lossR)) : null };
}

function sessionSwingSvg(sessions, opts = {}) {
  if (!sessions.length) return `<span>${esc(opts.empty || 'Sin sesiones con R conocida para estos filtros.')}</span>`;
  const normalized = opts.swingUnit !== 'usd';
  const value = (session, field) => session[field] / (normalized ? session.risk : 1);
  const label = amount => normalized ? `${num(amount, 2)} R` : usdMoney(amount);
  const width = Math.max(300, opts.width || 800), height = Math.max(180, opts.height || 300);
  const left = 88, right = 22, top = 18, bottom = 40;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  let low = Math.min(0, ...sessions.map(session => Math.min(value(session, 'minimum'), normalized ? -1 : -session.risk)));
  let high = Math.max(0, ...sessions.map(session => value(session, 'maximum')));
  const padding = (high - low) * 0.06 || 1;
  low -= padding; high += padding;
  const x = index => left + (index + 0.5) * plotWidth / sessions.length;
  const y = amount => top + (high - amount) / (high - low) * plotHeight;
  let shapes = '';
  for (let tick = 0; tick <= 4; tick++) {
    const amount = low + (high - low) * tick / 4;
    shapes += `<line x1="${left}" x2="${width - right}" y1="${y(amount)}" y2="${y(amount)}" stroke="#304058" stroke-dasharray="3 5"/><text x="${left - 9}" y="${y(amount) + 4}" fill="#9bb3cd" font-size="11" text-anchor="end">${esc(label(amount))}</text>`;
  }
  shapes += `<line x1="${left}" x2="${width - right}" y1="${y(0)}" y2="${y(0)}" stroke="#688099" stroke-dasharray="4 4"/>`;
  const stops = sessions.map((session, index) => `${index ? 'H' : 'M'}${x(index).toFixed(2)}${index ? ' V' : ','}${y(normalized ? -1 : -session.risk).toFixed(2)}`);
  const stopPath = sessions.length === 1 ? `M${left},${y(normalized ? -1 : -sessions[0].risk)} H${width - right}` : stops.join(' ');
  shapes += `<path d="${stopPath}" fill="none" stroke="#fb4f61" stroke-width="2" stroke-dasharray="5 4"/>`;
  const step = plotWidth / sessions.length;
  const barWidth = Math.min(14, step * 0.65);
  sessions.forEach((session, index) => {
    const minimum = value(session, 'minimum'), maximum = value(session, 'maximum'), final = value(session, 'pnl');
    const detail = `${session.date}. R: ${usdMoney(session.risk)}. Mínimo acumulado: ${usdSigned(session.minimum)} (${num(session.minimum / session.risk)} R). Máximo: ${usdSigned(session.maximum)} (${num(session.maximum / session.risk)} R). Cierre: ${usdSigned(session.pnl)} (${num(session.pnl / session.risk)} R). Swing: ${usdMoney(session.swing)} (${num(session.swing / session.risk)} R). ${session.count} trades. ${session.reachedStop ? 'Alcanza o supera −R.' : 'No alcanza −R.'} ${opts.explanation || ''}`;
    const color = session.reachedStop ? '#ffb454' : '#5c9bff';
    shapes += `<g ${helpAttributes(detail)}><rect x="${x(index) - barWidth / 2}" y="${y(maximum)}" width="${barWidth}" height="${Math.max(1, y(minimum) - y(maximum))}" rx="${Math.min(1, barWidth / 2)}" fill="${color}" opacity=".65"/><circle cx="${x(index)}" cy="${y(final)}" r="${Math.min(3, step * 0.25)}" fill="${session.pnl < 0 ? '#fb4f61' : '#35ebb3'}"/><rect x="${left + index * step}" y="${top}" width="${step}" height="${plotHeight}" fill="transparent"/></g>`;
  });
  const tickCount = Math.min(8, sessions.length, Math.max(1, Math.floor(plotWidth / 120)));
  for (let tick = 0; tick < tickCount; tick++) {
    const index = tickCount === 1 ? 0 : Math.round(tick * (sessions.length - 1) / (tickCount - 1));
    shapes += `<text x="${x(index)}" y="${height - 12}" fill="#97aec8" font-size="11" text-anchor="middle">${esc(chartLabel(sessions[index].date))}</text>`;
  }
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(opts.title || 'Oscilación del PnL por sesión frente a R')}">${shapes}</svg>`;
}

function renderSessionSwings(rows, projected = false, error = '') {
  const prefix = projected ? 'growth-projection-swing' : 'growth-swing';
  const result = sessionSwings(rows, sessionRiskHistory, projected);
  const explanation = 'Acumulado desde cero por fecha de cierre, con los filtros actuales. Barra: mínimo y máximo del PnL realizado tras cerrar trades; incluye el punto inicial cero. Los cierres históricos simultáneos se suman juntos. Punto: resultado final. Línea roja: −R vigente en esa sesión. Naranja: alcanza o supera −R. No incluye PnL de posiciones abiertas. Las sesiones continúan completas aunque alcancen −R.';
  $(`${prefix}-stats`).innerHTML = [
    ['Mayor pérdida acumulada de sesión', result.maximumLossR === null ? '—' : `${num(result.maximumLossR)} R`, 'Mayor distancia bajo cero observada al cerrar trades, dividida por la R de su sesión.'],
    ['Sesiones que alcanzan −R', result.reachedPercent === null ? '—' : `${num(result.reachedPercent, 1)} %`, `${result.reached} de ${result.sessions.length} sesiones con R conocida. Se comparan mínimos realizados con −R; no se simula la ejecución de un stop.`]
  ].map(args => consistencyMetric(...args)).join('');
  $(`${prefix}-note`).textContent = error || `${result.sessions.length} sesiones con R conocida; ${result.excludedSessions} excluidas por falta de R o datos válidos. Muestra los trades de los filtros actuales; filtrar símbolos, dirección o noticias puede mostrar solo una parte de cada sesión.`;
  renderChart(`${prefix}-chart`, [{ values: result.sessions.map(session => [session.date, session.pnl]) }], {
    sessionSwing: result.sessions, swingUnit: $(`${prefix}-unit`).value,
    title: projected ? 'Oscilación proyectada del PnL frente al stop' : 'Oscilación histórica del PnL frente al stop',
    explanation, empty: error || 'Sin sesiones con R conocida para estos filtros.'
  });
}
