'use strict';

function durationSummary(rows) {
  const wins = rows.filter(trade => classify(trade) === 'win');
  const losses = rows.filter(trade => classify(trade) === 'loss');
  const quantities = rows.filter(trade => Number.isFinite(trade.entryQty) && trade.entryQty > 0);
  const holds = rows.map(trade => trade.holdMinutes).filter(value => Number.isFinite(value) && value >= 0);
  const grossWin = sum(wins), grossLoss = -sum(losses);
  const quantity = quantities.reduce((total, trade) => total + trade.entryQty, 0);
  const winAverage = wins.length ? grossWin / wins.length : null;
  const lossAverage = losses.length ? grossLoss / losses.length : null;
  return {
    count: rows.length, wins: wins.length, losses: losses.length, scratches: rows.length - wins.length - losses.length,
    pnl: sum(rows), average: rows.length ? sum(rows) / rows.length : null,
    winRate: rows.length ? 100 * wins.length / rows.length : null, winAverage, lossAverage,
    rr: wins.length && losses.length ? winAverage / lossAverage : null,
    pf: grossLoss ? grossWin / grossLoss : grossWin ? Infinity : null,
    fees: rows.reduce((total, trade) => total + (Number.isFinite(trade.fees) ? trade.fees : 0), 0),
    quantity: quantities.length ? quantity : null, quantityCount: quantities.length,
    averageQuantity: quantities.length ? quantity / quantities.length : null,
    pnlPerShare: quantity ? sum(quantities) / quantity : null,
    mean: holds.length ? mean(holds) : null, median: sampleQuantile(holds, 0.5),
    q1: sampleQuantile(holds, 0.25), q3: sampleQuantile(holds, 0.75), p90: sampleQuantile(holds, 0.9)
  };
}

function durationStudyGroups(rows, width) {
  const groups = new Map();
  const unknown = [];
  for (const trade of rows) {
    if (!Number.isFinite(trade.holdMinutes) || trade.holdMinutes < 0) { unknown.push(trade); continue; }
    const index = Math.floor(trade.holdMinutes / width);
    if (!groups.has(index)) groups.set(index, []);
    groups.get(index).push(trade);
  }
  const result = [...groups].sort(([left], [right]) => left - right).map(([index, trades]) => ({
    name: `${index * width}–${(index + 1) * width} min`, rows: trades, ...durationSummary(trades), unknown: false
  }));
  if (unknown.length) result.push({ name: 'Sin duración', rows: unknown, ...durationSummary(unknown), unknown: true });
  return result;
}

function durationScatterSvg(series, opts) {
  const points = series.flatMap(item => item.values).filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]));
  if (!points.length) return `<span>${esc(opts.empty || 'Sin operaciones con datos disponibles para estos filtros.')}</span>`;
  const width = Math.max(240, opts.width || 800), height = Math.max(160, opts.height || 275);
  const left = 78, right = 22, top = 18, bottom = 46;
  const xMax = opts.xCategories ? Math.max(1, opts.xCategories.length - 1) : Math.max(opts.xCurrency ? 0.01 : 1, ...points.map(point => point[0]));
  const yMin = Math.min(0, ...points.map(point => point[1]));
  const yMax = Math.max(0, yMin + 1, ...points.map(point => point[1]));
  const x = value => left + (opts.xCategories?.length === 1 ? 0.5 : value / xMax) * (width - left - right);
  const y = value => top + (yMax - value) / (yMax - yMin) * (height - top - bottom);
  const format = value => opts.currency ? (opts.currencyUnit === 'usd' ? usdMoney(value) : money(value)) : num(value, opts.yDecimals || 0);
  let shapes = '';
  for (let tick = 0; tick <= 4; tick++) {
    const value = yMin + (yMax - yMin) * tick / 4;
    shapes += `<line x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}" stroke="#304058" stroke-dasharray="3 5"/><text x="${left - 8}" y="${y(value) + 4}" text-anchor="end" fill="#9bb3cd" font-size="11">${esc(format(value))}</text>`;
    if (!opts.xCategories) {
      const value = xMax * tick / 4;
      shapes += `<text x="${x(value)}" y="${height - 24}" text-anchor="${tick === 0 ? 'start' : tick === 4 ? 'end' : 'middle'}" fill="#9bb3cd" font-size="11">${esc(opts.xCurrency ? usdMoney(value) : num(value, 1))}</text>`;
    }
  }
  if (opts.xCategories) {
    const ticks = Math.min(opts.xCategories.length, Math.max(1, Math.floor((width - left - right) / 140) + 1));
    for (let tick = 0; tick < ticks; tick++) {
      const index = ticks === 1 ? 0 : Math.round(tick * (opts.xCategories.length - 1) / (ticks - 1));
      const name = opts.xCategories[index];
      shapes += `<text x="${x(index)}" y="${height - 24}" text-anchor="${ticks === 1 ? 'middle' : tick === 0 ? 'start' : tick === ticks - 1 ? 'end' : 'middle'}" fill="#9bb3cd" font-size="11" ${helpAttributes(name)}>${esc(chartLabel(name))}</text>`;
    }
  }
  shapes += `<line x1="${left}" x2="${width - right}" y1="${y(0)}" y2="${y(0)}" stroke="#688099" stroke-dasharray="4 4"/><text x="${(left + width - right) / 2}" y="${height - 5}" text-anchor="middle" fill="#9bb3cd" font-size="11">${esc(opts.xLabel || 'Duración (min)')}</text>`;
  for (const item of series) for (const point of item.values) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    shapes += `<circle cx="${x(point[0])}" cy="${y(point[1])}" r="4" fill="${item.color}" fill-opacity=".65" ${helpAttributes(`${point[2]}\n\n${opts.explanation}`)}><title>${esc(point[2])}</title></circle>`;
  }
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(opts.title)}">${shapes}</svg>`;
}

function renderDurationStudies(rows) {
  const selectedWidth = Number($('duration-range-width').value);
  const width = [1, 5, 10, 15, 30, 60].includes(selectedWidth) ? selectedWidth : 5;
  const groups = durationStudyGroups(rows, width), known = groups.filter(group => !group.unknown);
  const available = rows.filter(trade => Number.isFinite(trade.holdMinutes) && trade.holdMinutes >= 0);
  const missing = rows.length - available.length;
  const summary = durationSummary(available);
  const minutes = value => value === null ? '—' : `${num(value, 1)} min`;
  $('duration-study-note').textContent = `${available.length} operaciones con duración · ${missing} sin duración válida. Rangos de ${width} min: límite inferior incluido y superior excluido; se omiten rangos vacíos. Todos los estudios respetan los filtros actuales. La relación observada no permite deducir qué habría pasado cerrando antes o después.`;
  const cards = [
    ['Duración media', minutes(summary.mean), 'Media de los minutos entre apertura y cierre, solo con duraciones válidas.'],
    ['Duración mediana', minutes(summary.median), 'Percentil 50 de duración: la mitad de la muestra queda a cada lado. Reduce el peso de operaciones excepcionalmente largas.'],
    ['Duración · percentil 90', minutes(summary.p90), 'Percentil 90 de duración con interpolación lineal. Aproximadamente el 90 % de las duraciones queda por debajo.']
  ];
  for (const [kind, label] of [['win', 'Ganadoras'], ['loss', 'Perdedoras'], ['scratch', 'A cero']]) {
    const sample = available.filter(trade => classify(trade) === kind), stats = durationSummary(sample);
    cards.push([`Duración media · ${label}`, minutes(stats.mean), `Media de duración de ${sample.length} operaciones ${label.toLowerCase()}.`],
      [`Duración mediana · ${label}`, minutes(stats.median), `Mediana de duración de ${sample.length} operaciones ${label.toLowerCase()}.`]);
  }
  $('duration-stats').innerHTML = cards.map(args => consistencyMetric(...args)).join('');
  const explanation = `Operaciones agrupadas por duración entre apertura y cierre. Rangos de ${width} minutos, límite inferior incluido y superior excluido. Solo duraciones válidas; sin rangos vacíos. Filtros actuales. Las muestras menores de 20 trades se indican en la ayuda y en la tabla. ${HELP_PNL}`;
  const charts = [
    ['count', 'count', 'Operaciones por duración', {}, 'Número de trades cerrados únicos.'],
    ['pnl', 'pnl', 'PnL por duración', { currency: true }, 'Suma del PnL registrado.'],
    ['average', 'average', 'PnL medio por duración', { currency: true }, 'PnL total ÷ número de operaciones del rango.'],
    ['winrate', 'winRate', 'Win rate por duración', { unit: '%', max: 100 }, 'Ganadoras ÷ todas las operaciones del rango × 100; incluye trades a cero.'],
    ['rr', 'rr', 'Ganancia / pérdida media por duración', { unit: 'x' }, 'Ganancia media ÷ valor absoluto de pérdida media. Requiere ganadoras y perdedoras; es una relación realizada, no riesgo planificado.'],
    ['pf', 'pf', 'Profit factor por duración', { unit: 'x', suppressRatioMeaning: true }, 'Suma de ganancias ÷ valor absoluto de pérdidas. Los valores infinitos o no definidos se conservan en la tabla, sin representarlos como cero.'],
    ['quantity', 'quantity', 'Acciones totales por duración', { unit: ' acciones' }, 'Suma de entryQty positivos disponibles. Cuenta acciones de entrada, sin sumar otra vez las salidas.'],
    ['average-quantity', 'averageQuantity', 'Acciones medias por duración', { unit: ' acciones' }, 'Acciones totales ÷ operaciones con cantidad de entrada válida.'],
    ['per-share', 'pnlPerShare', 'PnL por acción y duración', { currency: true }, 'Suma del PnL de trades con cantidad válida ÷ suma de sus acciones de entrada. Es una media ponderada, no rentabilidad ni riesgo por acción.']
  ];
  for (const [id, field, title, options, meaning] of charts) {
    renderChart(`duration-${id}-chart`, [{ values: known.filter(group => Number.isFinite(group[field])).map(group => [group.name, group[field], `${group.count} trades; ${group.quantityCount} con cantidad válida.${group.count < 20 ? ' Muestra reducida (<20).' : ''}`]), color: '#5c9bff' }],
      { bar: true, ...options, title, explanation: `${meaning} ${explanation}`, empty: 'Sin valores calculables para estos filtros. Consulta el detalle de la tabla.' });
  }
  const outcomes = [['win', '#29d17e'], ['loss', '#fb4f61'], ['scratch', '#98adc8']];
  for (const [id, field, title, options] of [
    ['pnl', 'pnl', 'Duración frente a PnL por operación', { currency: true }],
    ['quantity', 'entryQty', 'Duración frente a acciones por operación', {}]
  ]) {
    const scatterRows = available.filter(trade => Number.isFinite(trade[field]) && (field !== 'entryQty' || trade.entryQty > 0));
    renderChart(`duration-scatter-${id}`, outcomes.map(([kind, color]) => ({ color, values: scatterRows.filter(trade => classify(trade) === kind).map(trade => [
      trade.holdMinutes, trade[field], `${trade.symbol} · ${trade.date} · ${trade.id}: ${num(trade.holdMinutes, 2)} min; PnL ${signed(trade.pnl)}; acciones ${Number.isFinite(trade.entryQty) && trade.entryQty > 0 ? num(trade.entryQty, 0) : 'sin confirmar'}.`
    ]) })), { scatter: true, ...options, title, explanation: `Cada punto es un trade, sin agrupar ni muestrear. Eje X: duración real en minutos, escala lineal. Verde: ganadora; rojo: perdedora; gris: a cero. ${scatterRows.length} puntos disponibles. ${explanation}` });
  }
  $('duration-distribution-table').innerHTML = tableMarkup(['Resultado', 'Operaciones', 'Media (min)', 'P25 (min)', 'Mediana (min)', 'P75 (min)', 'P90 (min)'],
    [['Todos', available], ['Ganadoras', available.filter(trade => classify(trade) === 'win')], ['Perdedoras', available.filter(trade => classify(trade) === 'loss')], ['A cero', available.filter(trade => classify(trade) === 'scratch')]].map(([label, sample]) => {
      const stats = durationSummary(sample);
      return [label, sample.length, ...['mean', 'q1', 'median', 'q3', 'p90'].map(field => num(stats[field], 2))];
    }));
  $('duration-table').innerHTML = groups.length ? tableMarkup([
    'Duración', 'Operaciones', 'Ganadoras', 'Perdedoras', 'A cero', 'Win rate', 'PnL', 'PnL medio', 'Ganancia media', 'Pérdida media', 'RR realizado', 'Profit factor',
    'Comisiones', 'Acciones totales', 'Acciones medias', 'Trades con acciones', 'PnL / acción', 'Duración mediana (min)', 'Muestra'
  ], groups.map(group => [group.name, group.count, group.wins, group.losses, group.scratches, `${num(group.winRate, 1)}%`, signed(group.pnl), money(group.average), money(group.winAverage),
    group.lossAverage === null ? '—' : money(-group.lossAverage), group.rr === null ? '—' : `${num(group.rr)} : 1`, ratioValue(group.pf), usdMoney(group.fees),
    group.quantity === null ? '—' : num(group.quantity, 0), num(group.averageQuantity, 1), group.quantityCount, money(group.pnlPerShare), num(group.median, 2), group.count < 20 ? 'Reducida (<20)' : '20 o más'
  ])) : '<p class="muted">Sin operaciones para estos filtros.</p>';
}
