'use strict';

let optimalSimulationCache = null;

function optimalPath(sessions) {
  let pnl = 0, peak = 0, drawdown = 0, minimum = 0;
  for (const session of sessions) {
    drawdown = Math.max(drawdown, session.drawdown, peak - pnl - session.minimum);
    minimum = Math.min(minimum, pnl + session.minimum);
    peak = Math.max(peak, pnl + session.maximum);
    pnl += session.pnl;
  }
  return { pnl, drawdown, minimum };
}

function optimalSample(rows, history) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
  const groups = new Map(), trades = [];
  let excluded = 0;
  for (const trade of rows) {
    const opened = Date.parse(trade.opened), closed = Date.parse(trade.closed);
    if (!Number.isFinite(opened) || !Number.isFinite(closed) || closed < opened || !Number.isFinite(trade.pnl)) { excluded++; continue; }
    const date = formatter.format(new Date(opened));
    const risk = sessionRiskAt(date, history)?.risk;
    if (!Number.isFinite(risk) || risk <= 0) { excluded++; continue; }
    const normalized = { id: trade.id, closed, value: trade.pnl / risk };
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(normalized);
    trades.push(normalized);
  }
  const sessions = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => {
    const closes = new Map();
    for (const trade of values) closes.set(trade.closed, (closes.get(trade.closed) || 0) + trade.value);
    let pnl = 0, minimum = 0, maximum = 0, drawdown = 0;
    for (const [, value] of [...closes].sort(([a], [b]) => a - b)) {
      pnl += value;
      minimum = Math.min(minimum, pnl);
      maximum = Math.max(maximum, pnl);
      drawdown = Math.max(drawdown, maximum - pnl);
    }
    return { date, pnl, minimum, maximum, drawdown };
  });
  const overlapping = sessions.some(session => groups.get(session.date)
    .some(trade => formatter.format(new Date(trade.closed)) > session.date));
  return { trades, sessions, excluded, overlapping, historical: optimalPath(sessions) };
}

function optimalSimulations(sample, horizon, simulations = 1000, blockSize = 5) {
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > 1000
    || !Number.isInteger(simulations) || simulations < 1 || simulations > 10000
    || !Number.isInteger(blockSize) || blockSize < 1) throw new Error('Invalid simulation settings');
  if (!sample.sessions.length) return null;
  let seed = 2166136261;
  for (const session of sample.sessions) {
    for (const value of [session.pnl, session.minimum, session.maximum, session.drawdown]) seed = Math.imul(seed ^ Math.round(value * 1e6), 16777619) >>> 0;
  }
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const paths = [];
  for (let run = 0; run < simulations; run++) {
    const sessions = [];
    while (sessions.length < horizon) {
      const start = Math.floor(random() * sample.sessions.length);
      for (let offset = 0; offset < Math.min(blockSize, sample.sessions.length) && sessions.length < horizon; offset++) {
        sessions.push(sample.sessions[(start + offset) % sample.sessions.length]);
      }
    }
    paths.push(optimalPath(sessions));
  }
  return { paths, horizon, simulations, blockSize,
    median: sampleQuantile(paths.map(path => path.pnl), 0.5),
    lower: sampleQuantile(paths.map(path => path.pnl), 0.05),
    upper: sampleQuantile(paths.map(path => path.pnl), 0.95),
    drawdown95: sampleQuantile(paths.map(path => path.drawdown), 0.95),
    minimum: Math.min(...paths.map(path => path.minimum)) };
}

function optimalSizing(sample, simulation, capital, limit, risk, maximum) {
  if (![capital, limit, risk, maximum].every(value => Number.isFinite(value) && value > 0)
    || limit >= capital || maximum > 20) throw new Error('Indica capital y R positivos, un drawdown inferior al capital y un tamaño máximo de hasta ×20.');
  if (!simulation) return { candidates: [], selected: null, reason: 'Sin operaciones con R conocida para simular.' };
  const values = sample.trades.map(trade => trade.value);
  let reason = '';
  if (sample.overlapping) reason = 'Hay posiciones que continúan en sesiones posteriores. Esta versión requiere sesiones sin posiciones abiertas de días anteriores.';
  else if (sample.trades.length < 30 || sample.sessions.length < 20) reason = 'Muestra insuficiente: se requieren al menos 30 trades y 20 sesiones con R conocida.';
  else if (!values.some(value => value < 0)) reason = 'La muestra no contiene pérdidas para estimar el riesgo adverso.';
  else if (values.reduce((total, value) => total + value, 0) <= 0 || simulation.median <= 0) reason = 'La muestra no muestra una ventaja positiva suficiente: esperanza o resultado mediano no positivos.';
  const worstDrawdown = Math.max(sample.historical.drawdown, simulation.drawdown95);
  const worstMinimum = -Math.min(sample.historical.minimum, simulation.minimum, 0);
  const bound = Math.min(maximum, worstDrawdown > 0 ? limit / (risk * worstDrawdown) : maximum,
    worstMinimum > 0 ? capital * 0.999 / (risk * worstMinimum) : maximum);
  const selected = reason ? null : Math.floor(bound * 100) / 100;
  if (!reason && selected < 0.01) reason = 'Ningún tamaño desde ×0,01 cumple los límites indicados.';
  const sizes = new Set([0, Math.min(1, maximum), maximum]);
  for (let index = 1; index < 20; index++) sizes.add(Number((maximum * index / 20).toFixed(4)));
  if (selected >= 0.01) { sizes.add(selected); sizes.add(selected / 2); }
  const candidates = [...sizes].sort((a, b) => a - b).map(size => {
    const scale = risk * size;
    const bankrupt = simulation.paths.filter(path => capital + path.minimum * scale <= 0).length;
    const exceeded = simulation.paths.filter(path => path.drawdown * scale > limit + 1e-8).length;
    const historicalDrawdown = sample.historical.drawdown * scale, adverseDrawdown = simulation.drawdown95 * scale;
    return { size, risk: scale, historicalPnl: sample.historical.pnl * scale, historicalDrawdown,
      median: simulation.median * scale, lower: simulation.lower * scale, upper: simulation.upper * scale,
      adverseDrawdown, bankruptPercent: bankrupt / simulation.simulations * 100,
      exceededPercent: exceeded / simulation.simulations * 100,
      acceptable: historicalDrawdown <= limit + 1e-8 && adverseDrawdown <= limit + 1e-8 && !bankrupt
        && capital + sample.historical.minimum * scale > 0 };
  });
  return { candidates, selected: reason ? null : candidates.find(item => item.size === selected), reason };
}

function renderOptimal(rows) {
  const inputs = ['optimal-capital', 'optimal-drawdown', 'optimal-horizon', 'optimal-maximum'];
  const [capital, drawdown, horizon, maximum] = inputs.map(id => $(id).value.trim() ? Number($(id).value) : NaN);
  const unit = $('optimal-drawdown-unit').value;
  const limit = unit === 'percent' ? capital * drawdown / 100 : drawdown;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const risk = sessionRiskAt(today)?.risk;
  const sample = optimalSample(rows, sessionRiskHistory);
  const values = sample.trades.map(trade => trade.value), wins = values.filter(value => value > 0), losses = values.filter(value => value < 0);
  const averageWin = wins.length ? mean(wins) : null, averageLoss = losses.length ? -mean(losses) : null;
  const winningSum = wins.reduce((a, b) => a + b, 0), losingSum = -losses.reduce((a, b) => a + b, 0);
  const decisive = wins.length + losses.length;
  const payoff = averageWin && averageLoss ? averageWin / averageLoss : null;
  const kelly = payoff ? (wins.length / decisive - losses.length / decisive / payoff) * 100 : null;
  $('optimal-kelly-note').textContent = kelly === null
    ? 'No calculable: se necesitan ganancias y pérdidas observadas.'
    : `Kelly binario aproximado: ${num(kelly)}%. Usa solo trades con resultado distinto de cero y resultados normalizados por R. Es una referencia teórica de apuesta con pérdida fija, no un porcentaje de riesgo aplicable a tus trades.`;
  const rValue = value => Number.isFinite(value) ? `${num(value, 3)} R` : '—';
  const metrics = [
    ['Trades utilizados', String(values.length), 'Operaciones filtradas con PnL válido y R conocida en su entrada.'],
    ['Sesiones utilizadas', String(sample.sessions.length), 'Sesiones agrupadas por el día de entrada en Nueva York.'],
    ['Win rate', pct(wins.length, values.length), 'Ganadoras / total; incluye trades a cero.'],
    ['Ganancia media', rValue(averageWin), 'Media de PnL/R histórica de las ganadoras. R es el presupuesto de la sesión.'],
    ['Pérdida media', rValue(averageLoss), 'Media absoluta de PnL/R histórica de las perdedoras; no es el riesgo inicial de un trade.'],
    ['RR realizado', averageLoss ? num(averageWin / averageLoss) : '—', 'Ganancia media / pérdida media, con resultados normalizados por R histórica.'],
    ['Esperanza por trade', values.length ? rValue(mean(values)) : '—', 'Promedio de todos los PnL/R históricos, incluidos ceros.'],
    ['Profit factor', losingSum ? num(winningSum / losingSum) : winningSum ? '∞' : '—', 'Suma de ganancias / suma absoluta de pérdidas, normalizadas por R.'],
    ['Peor trade', values.length ? rValue(Math.min(...values)) : '—', 'Peor resultado cerrado dividido por la R vigente en su entrada.'],
    ['Drawdown histórico', values.length ? rValue(sample.historical.drawdown) : '—', 'Mayor caída desde un máximo del PnL normalizado, incluyendo los cierres dentro de cada sesión.']
  ];
  $('optimal-sample-stats').innerHTML = metrics.map(args => consistencyMetric(...args)).join('');
  $('optimal-sample-note').textContent = `${rows.length} trades filtrados · ${sample.excluded} excluidos por falta de R, PnL o fechas válidas. Cada resultado se divide por la R vigente en su entrada. R representa riesgo máximo por sesión; no riesgo inicial por trade.`;
  let result = { candidates: [], selected: null, reason: '' }, simulation = null;
  try {
    if (!Number.isInteger(horizon) || horizon < 1 || horizon > 1000) throw new Error('El horizonte debe ser un número entero entre 1 y 1.000 sesiones.');
    if (!['percent', 'usd'].includes(unit)) throw new Error('Selecciona una unidad de drawdown válida.');
    const key = JSON.stringify([horizon, sample.sessions]);
    if (optimalSimulationCache?.key !== key) optimalSimulationCache = { key, value: optimalSimulations(sample, horizon) };
    simulation = optimalSimulationCache.value;
    result = optimalSizing(sample, simulation, capital, limit, risk, maximum);
  } catch (error) { result.reason = error.message; }
  const chosen = result.selected;
  $('optimal-result-status').textContent = chosen
    ? `Mayor tamaño que cumple el criterio: ×${num(chosen.size)}. Drawdown histórico y P95 simulado ≤ ${money(limit)} (${num(limit / capital * 100)}% del capital inicial), sin agotamiento del capital en los escenarios simulados.${chosen.size >= maximum ? ' Se alcanza el máximo de tamaño explorado; no se ha establecido un óptimo por encima de ese límite.' : ''}`
    : result.reason;
  const conservative = chosen ? result.candidates.find(item => item.size === chosen.size / 2) : null;
  $('optimal-result-stats').innerHTML = [
    ['Tamaño según el criterio', chosen ? `×${num(chosen.size)}` : '—', 'Máximo multiplicador, redondeado hacia abajo a centésimas, que satisface las restricciones bajo este modelo.'],
    ['R equivalente por sesión', chosen ? money(chosen.risk) : '—', 'R vigente × multiplicador de tamaño. No cambia tu historial de R ni implica un stop ejecutable.'],
    ['Alternativa de menor exposición', conservative ? `×${num(conservative.size, 3)} · ${money(conservative.risk)}/sesión` : '—', 'La mitad del tamaño seleccionado; sus ganancias y pérdidas simuladas también se reducen a la mitad.'],
    ['Resultado mediano simulado', chosen ? signed(chosen.median) : '—', `PnL mediano al final de ${horizon} sesiones con un importe fijo por sesión, sin capitalización.`]
  ].map(args => consistencyMetric(...args)).join('');
  $('optimal-simulation-note').textContent = simulation
    ? `${simulation.simulations.toLocaleString('es-ES')} simulaciones de ${horizon} sesiones. Bloques consecutivos de hasta ${simulation.blockSize} sesiones, con inicio aleatorio y continuidad circular; se conservan los cierres y su orden dentro de cada sesión. P5–P95 describe escenarios del modelo, no una garantía. Drawdown medido en USD y como porcentaje del capital inicial. La muestra debe tener al menos 30 trades, 20 sesiones y pérdidas observadas para seleccionar un tamaño.`
    : 'Corrige los parámetros para calcular los escenarios.';
  const candidates = result.candidates;
  $('optimal-size-table').innerHTML = tableMarkup(
    ['Tamaño', 'R equivalente / sesión', 'PnL histórico reescalado', 'DD histórico reescalado', 'PnL P5', 'PnL mediano', 'PnL P95', 'DD P95', 'Supera límite DD', 'Agota capital', 'Cumple límites'],
    candidates.map(item => [`×${num(item.size, 3)}${chosen === item ? ' · seleccionado' : ''}`, money(item.risk), signed(item.historicalPnl), money(item.historicalDrawdown), signed(item.lower), signed(item.median), signed(item.upper), money(item.adverseDrawdown), `${num(item.exceededPercent, 1)}%`, `${num(item.bankruptPercent, 1)}%`, item.acceptable ? 'Sí' : 'No']));
  const points = field => candidates.map(item => [`×${num(item.size, 3)}`, item[field]]);
  renderChart('optimal-return-chart', [
    { values: points('lower'), color: '#ef6b7b' }, { values: points('median'), color: '#5c9bff' }, { values: points('upper'), color: '#29d17e' }
  ], { currency: true, title: 'Resultado simulado por tamaño', explanation: `P5, mediana y P95 del PnL final a ${horizon} sesiones. Se escala PnL/R histórica por R vigente y tamaño, con presupuesto fijo y costes registrados ya incluidos.`, empty: result.reason });
  renderChart('optimal-drawdown-chart', [
    { values: points('historicalDrawdown'), color: '#5c9bff' }, { values: points('adverseDrawdown'), color: '#f2ad66' },
    { values: candidates.map(item => [`×${num(item.size, 3)}`, limit]), color: '#ef6b7b' }
  ], { currency: true, title: 'Drawdown por tamaño', explanation: 'Azul: drawdown del historial normalizado. Naranja: percentil 95 del drawdown máximo simulado. Rojo: límite elegido en USD, equivalente al porcentaje indicado del capital inicial. Incluye cierres intrasesión; no incluye pérdidas latentes.', empty: result.reason });
}

function initializeOptimal() {
  for (const id of ['optimal-capital', 'optimal-drawdown', 'optimal-horizon', 'optimal-maximum', 'optimal-drawdown-unit']) {
    $(id).addEventListener('change', () => renderOptimal(filtered));
  }
}
