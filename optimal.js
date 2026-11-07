'use strict';

function optimalSample(rows, history) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
  const trades = [], sessions = new Set();
  let excluded = 0;
  for (const trade of rows) {
    const opened = Date.parse(trade.opened);
    if (!Number.isFinite(opened) || !Number.isFinite(trade.pnl)) { excluded++; continue; }
    const date = formatter.format(new Date(opened));
    const risk = sessionRiskAt(date, history)?.risk;
    const value = trade.pnl / risk;
    if (!Number.isFinite(risk) || risk <= 0 || !Number.isFinite(value)) { excluded++; continue; }
    trades.push({ id: trade.id, value });
    sessions.add(date);
  }
  const wins = trades.filter(trade => trade.value > 0), losses = trades.filter(trade => trade.value < 0);
  const average = values => values.length ? values.reduce((sum, trade) => sum + trade.value, 0) / values.length : null;
  const averageLoss = losses.length ? -average(losses) : null;
  const averageWin = wins.length ? average(wins) : 0;
  const payoff = averageLoss ? averageWin / averageLoss : null;
  const decisive = wins.length + losses.length;
  const kelly = averageLoss ? (wins.length && payoff > 0
    ? Math.max(0, wins.length / decisive - losses.length / decisive / payoff) : 0) : null;
  return { trades, sessions: sessions.size, excluded, wins: wins.length, losses: losses.length,
    averageLoss, averageWin, payoff, expectancy: average(trades), kelly };
}

function optimalSizing(sample, targetPercent) {
  if (!Number.isFinite(targetPercent) || targetPercent < 0 || targetPercent > 100) {
    throw new Error('Indica una pérdida media entre el 0% y el 100% de R por trade perdedor.');
  }
  if (!sample.trades.length) return { selected: null, candidates: [], reason: 'Sin trades filtrados con PnL válido y R conocida en su entrada.' };
  if (!sample.averageLoss) return { selected: null, candidates: [], reason: 'Se necesita al menos un trade perdedor para calcular la pérdida media histórica.' };
  const historicalPercent = sample.averageLoss * 100;
  const scenario = percent => {
    const size = percent / historicalPercent;
    return { percent, size, averageLoss: percent / 100, averageWin: sample.averageWin * size,
      expectancy: sample.expectancy * size };
  };
  const selected = scenario(targetPercent), percentages = [historicalPercent, targetPercent];
  if (sample.kelly !== null) {
    const optimalPercent = sample.kelly * 100;
    for (let index = 0; index <= 5; index++) percentages.push(historicalPercent + (optimalPercent - historicalPercent) * index / 5);
  }
  const unique = [];
  for (const percent of percentages.sort((a, b) => a - b)) {
    if (!unique.some(value => Math.abs(value - percent) < 1e-9)) unique.push(percent);
  }
  const candidates = unique.map(scenario);
  if (candidates.some(item => ![item.size, item.averageWin, item.expectancy].every(Number.isFinite))) {
    throw new Error('La muestra produce un multiplicador fuera del rango calculable.');
  }
  return { selected, candidates, reason: '' };
}

function optimalKellyGrowth(sample, percent) {
  if (!sample.averageLoss || !Number.isFinite(percent) || percent < 0 || percent >= 100) return null;
  const fraction = percent / 100, total = sample.trades.length;
  return (sample.wins / total * Math.log1p(sample.payoff * fraction)
    + sample.losses / total * Math.log1p(-fraction)) * 100;
}

function optimalKellySvg(model, opts = {}) {
  const { sample, targetPercent } = model;
  if (!sample.averageLoss) return `<span>${esc(opts.empty || 'Se necesita una pérdida media histórica para construir la curva.')}</span>`;
  const width = Math.max(280, opts.width || 800), height = Math.max(250, opts.height || 340);
  const left = 68, right = 20, top = 24, bottom = 55, plotWidth = width - left - right, plotHeight = height - top - bottom;
  const markers = [
    { name: 'Histórico', percent: sample.averageLoss * 100, color: '#5c9bff' },
    { name: 'Kelly óptimo teórico', percent: sample.kelly * 100, color: '#29d17e' }
  ];
  if (Number.isFinite(targetPercent)) markers.push({ name: 'Elegido', percent: targetPercent, color: '#f2ad66' });
  const upperPercent = Math.max(1, ...markers.map(marker => marker.percent)) * 1.15;
  const curveEnd = Math.min(upperPercent, 99.5);
  const percentages = Array.from({ length: 181 }, (_, index) => curveEnd * index / 180);
  for (const marker of markers) if (marker.percent < 100) percentages.push(marker.percent);
  percentages.sort((a, b) => a - b);
  const points = percentages.map(percent => [percent, optimalKellyGrowth(sample, percent)]);
  let low = Math.min(0, ...points.map(point => point[1])), high = Math.max(0, ...points.map(point => point[1]));
  if (high === low) { high += 1; low -= 1; }
  const padding = (high - low) * 0.12;
  high += padding; low -= padding;
  const x = percent => left + percent / upperPercent * plotWidth;
  const y = growth => top + (high - growth) / (high - low) * plotHeight;
  const label = value => Number(value.toFixed(2)).toLocaleString('es-ES');
  const guide = marker => `${marker.name}: ${label(marker.percent)}% de R de pérdida media por trade perdedor. ${marker.percent < 100 ? `Crecimiento logarítmico teórico: ${label(optimalKellyGrowth(sample, marker.percent))}%.` : 'Fuera del dominio logarítmico del modelo (100% o más).'}`;
  let shapes = '';
  const start = Math.min(markers[0].percent, markers[1].percent), end = Math.max(markers[0].percent, markers[1].percent);
  shapes += `<rect x="${x(start)}" y="${top}" width="${x(end) - x(start)}" height="${plotHeight}" fill="#29d17e" opacity=".07"/>`;
  if (upperPercent >= 100) shapes += `<rect x="${x(100)}" y="${top}" width="${x(upperPercent) - x(100)}" height="${plotHeight}" fill="#ef6b7b" opacity=".1"/>`;
  for (let index = 0; index <= 4; index++) {
    const growth = low + (high - low) * index / 4;
    shapes += `<line x1="${left}" x2="${width - right}" y1="${y(growth)}" y2="${y(growth)}" stroke="#304058" stroke-dasharray="3 5"/><text x="${left - 8}" y="${y(growth) + 4}" fill="#9bb3cd" font-size="11" text-anchor="end">${esc(label(growth))}%</text>`;
  }
  const ticks = width < 500 ? 4 : 6;
  for (let index = 0; index <= ticks; index++) {
    const percent = upperPercent * index / ticks;
    shapes += `<text x="${x(percent)}" y="${height - 31}" fill="#9bb3cd" font-size="11" text-anchor="${index === 0 ? 'start' : index === ticks ? 'end' : 'middle'}">${esc(label(percent))}%</text>`;
  }
  shapes += `<line x1="${left}" x2="${width - right}" y1="${y(0)}" y2="${y(0)}" stroke="#688099" stroke-dasharray="4 4"/>`;
  shapes += `<path d="${points.map(([percent, growth], index) => `${index ? 'L' : 'M'}${x(percent).toFixed(2)},${y(growth).toFixed(2)}`).join(' ')}" fill="none" stroke="#a8bbd2" stroke-width="2"/>`;
  points.forEach(([percent, growth], index) => {
    if (index % 3 === 0) shapes += `<circle cx="${x(percent)}" cy="${y(growth)}" r="6" fill="transparent" ${helpAttributes(`${label(percent)}% de R · crecimiento logarítmico teórico ${label(growth)}%.`)}><title>${esc(`${label(percent)}% de R · ${label(growth)}% teórico`)}</title></circle>`;
  });
  for (const marker of markers) {
    const attributes = helpAttributes(guide(marker));
    shapes += `<line x1="${x(marker.percent)}" x2="${x(marker.percent)}" y1="${top}" y2="${height - bottom}" stroke="${marker.color}" stroke-width="1.5" stroke-dasharray="5 4" ${attributes}><title>${esc(guide(marker))}</title></line>`;
    const growth = optimalKellyGrowth(sample, marker.percent);
    if (growth !== null) shapes += `<circle cx="${x(marker.percent)}" cy="${y(growth)}" r="5" fill="${marker.color}" stroke="#101827" stroke-width="2" ${attributes}><title>${esc(guide(marker))}</title></circle>`;
  }
  shapes += `<text x="${left}" y="14" fill="#a8bbd2" font-size="10">Crecimiento logarítmico teórico · %</text><text x="${left + plotWidth / 2}" y="${height - 7}" text-anchor="middle" fill="#a8bbd2" font-size="11">Pérdida media por trade perdedor · % de R</text>`;
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Curva de Kelly: porcentaje histórico, elegido y óptimo teórico">${shapes}</svg>`;
}

function renderOptimal(rows) {
  const input = $('optimal-target-risk');
  const targetPercent = input.value.trim() ? Number(input.value) : NaN;
  const sample = optimalSample(rows, sessionRiskHistory);
  let result;
  try { result = optimalSizing(sample, targetPercent); }
  catch (error) { result = { selected: null, candidates: [], reason: error.message }; }
  const selected = result.selected;
  const percentLabel = value => Number.isFinite(value) ? `${num(value, 2)}% de R` : '—';
  const sizeLabel = value => Number.isFinite(value) ? `×${num(value, 3)}` : '—';
  $('optimal-data-note').textContent = `${sample.trades.length} trades filtrados utilizados · ${sample.losses} perdedores para calcular la media · ${sample.excluded} excluidos por falta de R, PnL o fecha de entrada válida.`;
  $('optimal-result-status').textContent = selected
    ? `Para pasar de una pérdida media histórica del ${num(sample.averageLoss * 100)}% de R al ${num(targetPercent)}% elegido, el tamaño se multiplica por ${sizeLabel(selected.size)}. Se escala el conjunto de trades filtrados por el mismo factor.`
    : result.reason;
  const kellyPercent = sample.kelly === null ? null : sample.kelly * 100;
  $('optimal-result-stats').innerHTML = [
    ['Pérdida media histórica', percentLabel(sample.averageLoss === null ? null : sample.averageLoss * 100), 'Media de |PnL/R de entrada| solo entre los trades perdedores filtrados.'],
    ['Pérdida media elegida', selected ? percentLabel(targetPercent) : '—', 'Objetivo medio entre trades perdedores; una pérdida individual puede superar este porcentaje.'],
    ['Tamaño óptimo', selected ? sizeLabel(selected.size) : '—', 'Porcentaje elegido / porcentaje histórico de pérdida media. Multiplica el tamaño histórico; no representa un número de shares.'],
    ['Kelly óptimo teórico', percentLabel(kellyPercent), 'Porcentaje de R que maximiza la curva binaria de Kelly de la muestra filtrada, usando 1 R como unidad hipotética de referencia.']
  ].map(args => consistencyMetric(...args)).join('');
  $('optimal-kelly-legend').innerHTML = [
    ['Histórico', sample.averageLoss === null ? null : sample.averageLoss * 100, 'accent'],
    ['Elegido', selected ? targetPercent : null, 'warning'],
    ['Kelly óptimo teórico', kellyPercent, 'positive']
  ].map(([name, value, kind]) => `<span class="${kind}">${esc(name)} · ${esc(percentLabel(value))}</span>`).join('');
  const notes = [];
  if (sample.kelly === 0) notes.push('Kelly no identifica ventaja positiva en esta muestra: su óptimo teórico es 0% de R.');
  if (sample.averageLoss && (sample.averageLoss * 100 >= 100 || (selected && targetPercent >= 100))) notes.push('Las marcas de 100% de R o más quedan fuera del dominio logarítmico de la curva.');
  if (sample.averageLoss && (sample.trades.length < 30 || sample.losses < 10)) notes.push('Muestra reducida: el porcentaje de Kelly y el multiplicador pueden ser inestables.');
  $('optimal-kelly-note').textContent = notes.join(' ');
  renderChart('optimal-kelly-chart', [], { optimalKelly: { sample, targetPercent: selected ? targetPercent : null },
    title: 'Curva de Kelly en relación con R', height: 340, empty: result.reason,
    explanation: 'Eje horizontal: pérdida media por trade perdedor como % de R. Eje vertical: crecimiento logarítmico teórico del modelo binario que toma 1 R como unidad hipotética de referencia. Azul: histórico. Naranja: elegido. Verde: máximo de Kelly. La banda sombreada une el histórico y el máximo teórico. No es una rentabilidad de cuenta.' });
}

function initializeOptimal() {
  $('optimal-target-risk').addEventListener('input', () => renderOptimal(filtered));
}
