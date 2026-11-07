'use strict';

function chronologicalTrades(rows) {
  return rows.slice().sort((a, b) => Date.parse(a.closed) - Date.parse(b.closed));
}

function compactPerformance(rows) {
  const wins = rows.filter(t => classify(t) === 'win');
  const loss = -sum(rows.filter(t => classify(t) === 'loss'));
  return { count: rows.length, pnl: sum(rows), winRate: rows.length ? wins.length / rows.length * 100 : null,
    average: rows.length ? sum(rows) / rows.length : null, pf: loss ? sum(wins) / loss : wins.length ? Infinity : null };
}

function rollingConsistency(rows, size) {
  const ordered = chronologicalTrades(rows);
  const points = [];
  for (let end = size; end <= ordered.length; end++) {
    const sample = ordered.slice(end - size, end);
    points.push({ end: ordered[end - 1].closed, ...compactPerformance(sample) });
  }
  return points;
}

function consistencyPeriod(date, unit) {
  if (unit === 'day') return date;
  if (unit === 'month') return date.slice(0, 7);
  const monday = new Date(`${date}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  return monday.toISOString().slice(0, 10);
}

function periodConsistency(rows, unit) {
  const groups = new Map();
  for (const trade of rows) {
    const key = consistencyPeriod(trade.date, unit);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(trade);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([period, sample]) => ({ period, ...compactPerformance(sample) }));
}

function recoveryEpisodes(rows) {
  const ordered = chronologicalTrades(rows);
  let equity = 0, peak = 0, peakIndex = -1, peakDate = ordered[0]?.date, active = null;
  const episodes = [];
  ordered.forEach((trade, index) => {
    equity += trade.pnl;
    if (equity < peak - EPSILON) {
      if (!active) active = { start: peakDate, trough: 0, peakIndex };
      active.trough = Math.max(active.trough, peak - equity);
    } else {
      if (active) {
        episodes.push({ ...active, end: trade.date, trades: index - active.peakIndex, recovered: true });
        active = null;
      }
      peak = Math.max(peak, equity);
      peakIndex = index;
      peakDate = trade.date;
    }
  });
  if (active) episodes.push({ ...active, end: ordered.at(-1).date, trades: ordered.length - 1 - active.peakIndex, recovered: false });
  return episodes.map(episode => ({ ...episode, days: Math.round((Date.parse(`${episode.end}T00:00:00Z`) - Date.parse(`${episode.start}T00:00:00Z`)) / 86400000) }));
}

function postOutcomeGroups(rows) {
  const closed = chronologicalTrades(rows);
  const opened = rows.slice().sort((a, b) => Date.parse(a.opened) - Date.parse(b.opened));
  const groups = { loss: [], win: [], scratch: [], none: [] };
  let cursor = 0;
  for (const trade of opened) {
    const opening = Date.parse(trade.opened);
    while (cursor < closed.length && Date.parse(closed[cursor].closed) <= opening) cursor++;
    let previous = closed[cursor - 1];
    if (previous === trade) previous = closed[cursor - 2];
    const key = previous ? classify(previous) : 'none';
    groups[key].push({ ...trade, waitMinutes: previous ? (opening - Date.parse(previous.closed)) / 60000 : null });
  }
  return groups;
}

function sampleQuantile(values, probability) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position), fraction = position - lower;
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * fraction;
}

function resampleConsistency(rows, horizon, simulations = 500) {
  const ordered = chronologicalTrades(rows);
  const sessions = new Map();
  for (const trade of ordered) {
    if (!sessions.has(trade.date)) sessions.set(trade.date, []);
    sessions.get(trade.date).push(trade.pnl);
  }
  const blocks = [...sessions.values()];
  if (!blocks.length) return null;
  let seed = 2166136261;
  for (const trade of ordered) seed = Math.imul(seed ^ Math.round(trade.pnl * 100), 16777619) >>> 0;
  const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
  const paths = [], finals = [], drawdowns = [], losingStreaks = [];
  for (let simulation = 0; simulation < simulations; simulation++) {
    let equity = 0, peak = 0, drawdown = 0, losing = 0, longest = 0, count = 0;
    const path = [0];
    while (count < horizon) {
      const block = blocks[Math.floor(random() * blocks.length)];
      for (const pnl of block) {
        equity += pnl;
        peak = Math.max(peak, equity);
        drawdown = Math.max(drawdown, peak - equity);
        losing = pnl < -EPSILON ? losing + 1 : 0;
        longest = Math.max(longest, losing);
        path.push(equity);
        if (++count === horizon) break;
      }
    }
    paths.push(path); finals.push(equity); drawdowns.push(drawdown); losingStreaks.push(longest);
  }
  const quantiles = [0.05, 0.5, 0.95].map(probability => Array.from({ length: horizon + 1 }, (_, index) => [String(index), sampleQuantile(paths.map(path => path[index]), probability)]));
  return { quantiles, finals, drawdowns, losingStreaks, sessions: blocks.length, simulations, horizon };
}

function consistencyMetric(label, value, explanation) {
  return `<div class="metric" tabindex="0" ${helpAttributes(explanation)}><div class="metric-label">${esc(label)}<span class="help-mark" aria-hidden="true">ⓘ</span></div><div class="metric-value">${esc(value)}</div></div>`;
}

function renderConsistencyStudies(rows) {
  const ordered = chronologicalTrades(rows);
  const chartWindow = Number($('consistency-window').value) || 50;
  const rolling = [25, 50, 100].map(size => [size, rollingConsistency(ordered, size)]);
  $('rolling-consistency-table').innerHTML = tableMarkup(['Ventana', 'Muestra', 'Win rate', 'Profit factor', 'PnL medio', 'Ventanas positivas'], rolling.map(([size, points]) => {
    const latest = points.at(-1);
    return [`${size} operaciones`, latest ? size : `${rows.length} / ${size}`, latest ? `${num(latest.winRate, 1)}%` : '—', latest ? ratioValue(latest.pf) : '—', latest ? money(latest.average) : '—', pct(points.filter(point => point.pnl > EPSILON).length, points.length)];
  }));
  const points = rolling.find(([size]) => size === chartWindow)?.[1] || [];
  renderChart('rolling-expectancy-chart', [{ values: points.map(point => [point.end, point.average]), color: '#5c9bff' }], { currency: true, explanation: `Media del PnL de las últimas ${chartWindow} operaciones cerradas. Cada punto requiere la ventana completa. Las ventanas se solapan y no son muestras independientes.`, empty: `Se necesitan al menos ${chartWindow} operaciones.` });
  renderChart('rolling-winrate-chart', [{ values: points.map(point => [point.end, point.winRate]), color: '#29d17e' }], { unit: '%', max: 100, explanation: `Ganadoras ÷ ${chartWindow} operaciones × 100 en cada ventana completa, incluidas las operaciones a cero. Las ventanas se solapan.`, empty: `Se necesitan al menos ${chartWindow} operaciones.` });

  const weeks = periodConsistency(ordered, 'week'), months = periodConsistency(ordered, 'month');
  const negativeRun = periods => { let current = 0, longest = 0; for (const period of periods) { current = period.pnl < -EPSILON ? current + 1 : 0; longest = Math.max(longest, current); } return longest; };
  $('period-consistency-stats').innerHTML = [
    ['Semanas positivas', pct(weeks.filter(period => period.pnl > EPSILON).length, weeks.length), 'Semanas con PnL positivo ÷ semanas con operaciones. Se agrupa de lunes a domingo por fecha de cierre NY. Solo períodos presentes en los filtros; los extremos pueden estar incompletos.'],
    ['Meses positivos', pct(months.filter(period => period.pnl > EPSILON).length, months.length), 'Meses con PnL positivo ÷ meses con operaciones; incluye meses a cero en el denominador.'],
    ['Racha de semanas negativas', weeks.length ? negativeRun(weeks) : '—', 'Mayor número consecutivo de semanas observadas con PnL negativo. Se omiten semanas sin operaciones.'],
    ['Racha de meses negativos', months.length ? negativeRun(months) : '—', 'Mayor número consecutivo de meses observados con PnL negativo. Se omiten meses sin operaciones.']
  ].map(args => consistencyMetric(...args)).join('');
  renderConsistencyStability(ordered);

  const winners = ordered.filter(trade => classify(trade) === 'win').sort((a, b) => b.pnl - a.pnl);
  const grossWins = sum(winners);
  $('winner-dependence-table').innerHTML = tableMarkup(['Escenario', 'Ganadoras excluidas', 'Ganancias positivas concentradas', 'Operaciones restantes', 'PnL restante', 'Profit factor restante'], [0, 1, 5, 10].map(limit => {
    const excluded = new Set(winners.slice(0, limit));
    const remaining = ordered.filter(trade => !excluded.has(trade));
    return [limit ? `Sin las ${limit} mejores ganadoras` : 'Historial completo', excluded.size, pct(sum([...excluded]), grossWins), remaining.length, signed(sum(remaining)), ratioValue(compactPerformance(remaining).pf)];
  }));

  const episodes = recoveryEpisodes(ordered), recovered = episodes.filter(episode => episode.recovered), open = episodes.find(episode => !episode.recovered);
  $('recovery-stats').innerHTML = [
    ['Recuperación media · operaciones', recovered.length ? num(mean(recovered.map(episode => episode.trades)), 1) : '—', 'Media de operaciones desde el último máximo hasta volver a alcanzarlo, incluyendo la operación que recupera. Solo episodios completados.'],
    ['Recuperación media · días', recovered.length ? num(mean(recovered.map(episode => episode.days)), 1) : '—', 'Media de días naturales entre el máximo y su recuperación. Solo episodios completados; no se suma el episodio abierto.'],
    ['Episodio abierto · operaciones', open ? open.trades : '0', 'Operaciones transcurridas bajo el máximo sin recuperar al final del historial filtrado. No es un tiempo de recuperación completado.']
  ].map(args => consistencyMetric(...args)).join('');
  $('recovery-table').innerHTML = episodes.length ? tableMarkup(['Máximo desde', 'Recuperación / último dato', 'Estado', 'Drawdown máximo', 'Operaciones hasta recuperación / actual', 'Días naturales'], episodes.map(episode => [episode.start, episode.end, episode.recovered ? 'Recuperado' : 'Abierto', money(episode.trough), episode.trades, episode.days])) : '<p class="muted">Sin episodios de drawdown para estos filtros.</p>';

  renderConsistencyConcentration(ordered);
  const outcomes = postOutcomeGroups(ordered);
  const behavior = [['Todas', Object.values(outcomes).flat()], ['Tras pérdida', outcomes.loss], ['Tras ganancia', outcomes.win], ['Tras cero', outcomes.scratch], ['Sin cierre previo', outcomes.none]];
  $('post-loss-table').innerHTML = tableMarkup(['Contexto al abrir', 'Operaciones', 'Shares medios', 'PnL medio', 'Pérdida media', 'Win rate', 'Espera mediana · min'], behavior.map(([name, sample]) => {
    const quantities = sample.map(trade => trade.entryQty).filter(value => Number.isFinite(value) && value > 0);
    const losses = sample.filter(trade => classify(trade) === 'loss');
    const waits = sample.map(trade => trade.waitMinutes).filter(Number.isFinite);
    return [name, sample.length, quantities.length ? num(mean(quantities), 1) : '—', sample.length ? money(sum(sample) / sample.length) : '—', losses.length ? money(sum(losses) / losses.length) : '—', pct(sample.filter(trade => classify(trade) === 'win').length, sample.length), waits.length ? num(sampleQuantile(waits, 0.5), 1) : '—'];
  }));
  renderConsistencyScenarios(ordered);
}

function renderConsistencyStability(rows) {
  const selected = $('consistency-stability-period').value;
  const unit = ['month', 'week', 'day'].includes(selected) ? selected : 'week';
  const label = { month: 'Mes', week: 'Semana', day: 'Día' }[unit];
  const scope = { month: 'meses', week: 'semanas de lunes a domingo', day: 'días' }[unit];
  const periods = periodConsistency(rows, unit);
  $('consistency-stability-note').textContent = `Compara PnL medio por operación, acierto y profit factor entre ${scope}, por fecha de cierre en Nueva York. Solo periodos con operaciones y con los filtros actuales; los extremos pueden ser parciales. Se muestran todas las muestras, incluidas las pequeñas. Un periodo positivo no garantiza estabilidad futura.`;
  $('monthly-consistency-table').innerHTML = periods.length ? tableMarkup([label, 'Operaciones', 'PnL', 'PnL medio', 'Win rate', 'Profit factor'], periods.map(period => [
    unit === 'week' ? `Semana del ${period.period}` : period.period, period.count, signed(period.pnl), money(period.average), `${num(period.winRate, 1)}%`, ratioValue(period.pf)
  ])) : '<p class="muted">Sin operaciones para estos filtros.</p>';
  renderChart('monthly-expectancy-chart', [{ values: periods.map(period => [period.period, period.average, `${label}${unit === 'week' ? ' del' : ':'} ${period.period}; ${period.count} operaciones.${period.count < 20 ? ' Muestra reducida (<20).' : ''}`]), color: '#5c9bff' }], {
    bar: true, currency: true, title: `PnL medio por ${label.toLowerCase()}`,
    explanation: `PnL del periodo ÷ sus operaciones, por fecha de cierre en Nueva York. Agrupación por ${scope}. Se omiten periodos vacíos; los extremos pueden ser parciales. Se aplican los filtros actuales. Compara la media por operación; no representa rentabilidad sobre capital. ${HELP_PNL}`
  });
}

function concentrationGroups(rows, key) {
  const groups = groupedStatistics(rows, key);
  const positive = groups.reduce((total, [, sample]) => total + Math.max(0, sum(sample)), 0);
  const total = sum(rows);
  return groups.map(([name, sample]) => ({ name, count: sample.length, pnl: sum(sample),
    weight: positive ? 100 * Math.max(0, sum(sample)) / positive : null, without: total - sum(sample) }));
}

function concentrationChartSvg(series, opts) {
  const points = series.flatMap(item => item.values).filter(point => Number.isFinite(point[1]));
  if (!points.length) return `<span>${esc(opts.empty || 'Sin operaciones para estos filtros.')}</span>`;
  const width = Math.max(320, opts.width || 800), left = Math.min(175, width * 0.36), right = 92;
  const top = 38, rowHeight = 29, height = top + points.length * rowHeight + 12;
  const low = Math.min(0, ...points.map(point => point[1]));
  const high = Math.max(opts.max || 0, 0, ...points.map(point => point[1]), low === 0 ? 1 : 0);
  const x = value => left + (value - low) / (high - low) * (width - left - right);
  const valueLabel = value => opts.currency ? money(value) : `${num(value, 1)}${opts.unit || ''}`;
  let shapes = '';
  for (let tick = 0; tick <= 2; tick++) {
    const value = low + (high - low) * tick / 2;
    shapes += `<line x1="${x(value)}" x2="${x(value)}" y1="${top - 12}" y2="${height - 8}" stroke="#304058" stroke-dasharray="3 5"/><text x="${x(value)}" y="17" text-anchor="${tick === 0 ? 'start' : tick === 2 ? 'end' : 'middle'}" fill="#9bb3cd" font-size="11">${esc(valueLabel(value))}</text>`;
  }
  shapes += `<line x1="${x(0)}" x2="${x(0)}" y1="${top - 12}" y2="${height - 8}" stroke="#688099"/>`;
  const labelLength = Math.max(7, Math.floor((left - 16) / 6.5));
  points.forEach((point, index) => {
    const y = top + index * rowHeight;
    const full = `${point[0]}: ${valueLabel(point[1])}. ${point[2]}\n\n${opts.explanation}`;
    const name = String(point[0]);
    const label = name.length > labelLength ? `${name.slice(0, labelLength - 1)}…` : name;
    shapes += `<text x="${left - 10}" y="${y + 4}" text-anchor="end" fill="#bfd1e9" font-size="11" ${helpAttributes(full)}>${esc(label)}</text><rect x="${Math.min(x(0), x(point[1]))}" y="${y - 8}" width="${Math.max(1, Math.abs(x(point[1]) - x(0)))}" height="17" rx="3" fill="${point[1] < 0 ? '#fb4f61' : '#5c9bff'}" ${helpAttributes(full)}><title>${esc(full)}</title></rect><text x="${width - 8}" y="${y + 4}" text-anchor="end" fill="#bfd1e9" font-size="11" ${helpAttributes(full)}>${esc(valueLabel(point[1]))}</text>`;
  });
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(opts.title)}">${shapes}</svg>`;
}

function renderConsistencyConcentration(rows) {
  const keys = {
    symbol: ['Ticker', trade => trade.symbol],
    country: ['País de constitución', trade => tradeCountry(trade) || 'Sin clasificar'],
    time: ['Horario de entrada · 5 min', trade => timeBand(trade, 5) || 'Sin horario'],
    weekday: ['Día de cierre', trade => ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][new Date(`${trade.date}T00:00:00Z`).getUTCDay()]]
  };
  const dimension = $('consistency-concentration').value;
  const [, key] = keys[dimension] || keys.symbol;
  const groups = concentrationGroups(rows, key);
  const explanation = `Se usa el PnL neto de cada grupo. Peso = máximo entre 0 y PnL del grupo ÷ suma de los PnL netos positivos de los grupos × 100. PnL sin grupo = PnL total filtrado − PnL del grupo. Se muestran todos los grupos, ordenados por PnL, con columnas ajustadas al ancho disponible. País utiliza exclusivamente la constitución legal; solo su ausencia genera Sin clasificar. ${HELP_PNL}`;
  for (const [id, field, title, options] of [
    ['pnl', 'pnl', 'PnL por grupo', { currency: true }],
    ['weight', 'weight', 'Peso en los beneficios de grupos', { unit: '%', max: 100, empty: 'Sin grupos con PnL positivo: el peso porcentual no se puede calcular.' }],
    ['without', 'without', 'PnL restante al excluir cada grupo', { currency: true }]
  ]) {
    renderChart(`consistency-concentration-${id}`, [{ values: groups.filter(group => Number.isFinite(group[field])).map(group => [group.name, group[field], `${group.count} operaciones; PnL del grupo ${signed(group.pnl)}; PnL sin este grupo ${signed(group.without)}.`]) }],
      { bar: true, ...options, title, explanation });
  }
}

let consistencyScenarioCache = null;
function renderConsistencyScenarios(rows) {
  const selected = Number($('consistency-horizon').value);
  const horizon = [25, 50, 100, 250].includes(selected) ? selected : 100;
  const signature = JSON.stringify([horizon, rows.map(trade => [trade.closed, trade.date, trade.pnl])]);
  if (consistencyScenarioCache?.signature !== signature) consistencyScenarioCache = { signature, result: resampleConsistency(rows, horizon) };
  const result = consistencyScenarioCache.result;
  $('consistency-scenario-note').textContent = result
    ? `500 escenarios de ${horizon} operaciones desde $0, remuestreando sesiones con reemplazo y conservando el orden dentro de cada sesión; el último bloque se recorta al horizonte. Base: ${result.sessions} sesiones. Los percentiles P5/P50/P95 se calculan por paso, no son tres trayectorias individuales ni intervalos de confianza. Se conserva el tamaño histórico; se ignoran cambios futuros y dependencia entre sesiones.${result.sessions < 20 ? ' Base reducida: menos de 20 sesiones.' : ''}`
    : 'Sin operaciones para generar escenarios.';
  $('consistency-scenario-table').innerHTML = result ? tableMarkup(['Resultado simulado', 'P5', 'Mediana · P50', 'P95'], [
    ['PnL final', ...[0.05, 0.5, 0.95].map(p => money(sampleQuantile(result.finals, p)))],
    ['Drawdown máximo', ...[0.05, 0.5, 0.95].map(p => money(sampleQuantile(result.drawdowns, p)))],
    ['Racha perdedora máxima', ...[0.05, 0.5, 0.95].map(p => num(sampleQuantile(result.losingStreaks, p), 1))],
    ['Escenarios con PnL final negativo', pct(result.finals.filter(value => value < -EPSILON).length, result.simulations), '—', '—']
  ]) : '<p class="muted">Sin escenarios para estos filtros.</p>';
  renderChart('consistency-scenario-chart', result ? result.quantiles.map((values, index) => ({ values, color: ['#ff6b7d', '#5c9bff', '#29d17e'][index] })) : [], { currency: true, explanation: $('consistency-scenario-note').textContent, empty: 'Sin operaciones para generar escenarios.' });
}

function initializeConsistencyStudies() {
  $('consistency-stability-period').addEventListener('change', () => renderConsistencyStability(filtered));
  $('consistency-window').addEventListener('change', () => renderConsistencyStudies(filtered));
  $('consistency-concentration').addEventListener('change', () => renderConsistencyConcentration(filtered));
  $('consistency-horizon').addEventListener('change', () => renderConsistencyScenarios(chronologicalTrades(filtered)));
}
