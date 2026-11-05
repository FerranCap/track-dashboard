'use strict';

const VIEW_DETAILS = {
  general: ['General', 'Tu actividad y resultados, de un vistazo.'],
  trades: ['Operaciones', 'Consulta y estudia tus operaciones individuales.'],
  calendar: ['Calendario', 'Resultados por sesión y evolución mensual.'],
  analysis: ['Análisis', 'Explora los factores que explican tus resultados.'],
  country: ['País', 'Estudia tu operativa por país de la empresa emisora.'],
  ratios: ['Ratios', 'Acierto, beneficio medio y relación entre ganancias y pérdidas.'],
  risk: ['Riesgo y consistencia', 'Caídas de capital, rachas y estabilidad de los resultados.'],
  compare: ['Comparativas', 'Contrasta dos grupos de operaciones con los mismos criterios.']
};
let selectedCalendarDay = '';

function activateView() {
  const key = location.hash.slice(1);
  const active = Object.hasOwn(VIEW_DETAILS, key) ? key : 'general';
  document.querySelectorAll('.view').forEach(view => { view.hidden = view.id !== `view-${active}`; });
  document.querySelectorAll('[data-view]').forEach(link => {
    if (link.dataset.view === active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  $('page-title').textContent = VIEW_DETAILS[active][0];
  $('page-description').textContent = VIEW_DETAILS[active][1];
  document.title = `${VIEW_DETAILS[active][0]} | Track`;
}

function groupedStatistics(rows, key) {
  const groups = new Map();
  for (const trade of rows) {
    const label = key(trade);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(trade);
  }
  return [...groups].sort((a, b) => sum(b[1]) - sum(a[1]));
}

function breakdownTable(groups) {
  return tableMarkup(['Grupo', 'Operaciones', 'Win rate', 'PnL', 'PnL medio', 'Profit factor'], groups.map(([name, rows]) => {
    const s = statistics(rows);
    return [name, rows.length, pct(s.wins.length, rows.length), signed(s.pnl), rows.length ? money(s.expectancy) : '—', ratioValue(s.pf)];
  }));
}

function ratioValue(value) {
  return value === Infinity ? '∞' : num(value);
}

function renderWorkspace(rows) {
  const s = statistics(rows);
  $('overview-stats').innerHTML = [
    ['PnL total', signed(s.pnl), cssSign(s.pnl)], ['Operaciones', integerFormat.format(rows.length)],
    ['Días operados', s.daily.length], ['Símbolos', new Set(rows.map(t => t.symbol)).size],
    ['Win rate', pct(s.wins.length, rows.length)], ['Profit factor', ratioValue(s.pf)],
    ['PnL medio / operación', rows.length ? money(s.expectancy) : '—'], ['Comisiones', money(s.fees), '', 'Incluidas en el resultado; no se descuentan de nuevo'],
    ['Volumen de entrada', integerFormat.format(s.entryVolumes), '', 'Acciones'],
    ['PnL medio / acción', s.entryVolumes ? money(s.pnl / s.entryVolumes) : '—'],
    ['Operaciones / día', s.daily.length ? num(rows.length / s.daily.length, 1) : '—'],
    ['PnL medio / día', s.daily.length ? money(mean(s.netByDate)) : '—'],
    ['Mejor operación', s.wins.length ? money(Math.max(...s.wins.map(t => t.pnl))) : '—', 'positive'],
    ['Peor operación', s.losses.length ? money(Math.min(...s.losses.map(t => t.pnl))) : '—', 'negative']
  ].map(item => metric(...item)).join('');
  $('recent-chart').innerHTML = svgChart([{ values: s.daily.slice(-10) }], { bar: true, currency: true, title: 'Últimas diez sesiones' });
  $('symbols-table').innerHTML = breakdownTable(groupedStatistics(rows, t => t.symbol));
  const durationBands = [['Menos de 1 min', 0, 1], ['1–5 min', 1, 5], ['5–15 min', 5, 15], ['15–60 min', 15, 60], ['60 min o más', 60, Infinity]];
  const durationGroups = durationBands.map(([name, min, max]) => [name, rows.filter(t => Number.isFinite(t.holdMinutes) && t.holdMinutes >= min && t.holdMinutes < max)]);
  const unknownDuration = rows.filter(t => !Number.isFinite(t.holdMinutes) || t.holdMinutes < 0);
  if (unknownDuration.length) durationGroups.push(['Sin duración', unknownDuration]);
  $('duration-table').innerHTML = breakdownTable(durationGroups);
  $('duration-stats').innerHTML = ['win', 'loss', 'scratch'].map((kind, index) => {
    const available = rows.filter(t => classify(t) === kind && Number.isFinite(t.holdMinutes));
    return metric(['Duración media · Ganadoras', 'Duración media · Perdedoras', 'Duración media · A cero'][index], available.length ? `${num(s.holds(kind), 1)} min` : '—');
  }).join('');
  renderCountries(rows);
  renderRatios(rows);
  renderCalendar(rows);
  renderComparisons();
}

function renderCountries(rows) {
  const known = rows.filter(t => typeof t.country === 'string' && t.country.trim());
  $('country-stats').innerHTML = [
    ['Países identificados', new Set(known.map(t => t.country)).size],
    ['Cobertura', pct(known.length, rows.length)], ['Sin clasificar', rows.length - known.length]
  ].map(item => metric(...item)).join('');
  $('country-note').textContent = known.length
    ? 'Los resultados sin clasificar se muestran por separado y se incluyen en el total.'
    : 'Los CSV actuales no incluyen el país de la empresa. Las operaciones se mantienen sin clasificar hasta disponer de esa información.';
  const groups = groupedStatistics(rows, t => t.country || 'Sin clasificar');
  $('country-table').innerHTML = groups.length ? breakdownTable(groups) : '<p class="muted">Sin operaciones para estos filtros.</p>';
  $('country-chart').innerHTML = svgChart([{ values: groups.map(([name, trades]) => [name, sum(trades)]), color: '#5c9bff' }], { bar: true, currency: true, title: 'PnL por país' });
}

function renderRatios(rows) {
  const s = statistics(rows);
  const decisive = s.wins.length + s.losses.length;
  const observed = decisive ? s.wins.length / decisive : null;
  const breakeven = s.wins.length && s.losses.length ? 1 / (1 + s.payOff) : null;
  $('ratio-stats').innerHTML = [
    ['Win rate', pct(s.wins.length, rows.length), '', 'Incluye operaciones a cero'],
    ['Acierto sin operaciones a cero', pct(s.wins.length, decisive)],
    ['Ganancia / pérdida media', s.wins.length && s.losses.length ? `${num(s.payOff)} : 1` : '—', '', 'Relación realizada'],
    ['Profit factor', ratioValue(s.pf)],
    ['Ganancia media', s.wins.length ? money(s.winAvg) : '—', 'positive'],
    ['Pérdida media', s.losses.length ? money(s.lossAvg) : '—', 'negative'],
    ['Esperanza / operación', rows.length ? money(s.expectancy) : '—', cssSign(s.expectancy)],
    ['Acierto de equilibrio', breakeven === null ? '—' : `${num(breakeven * 100, 1)}%`],
    ['Margen sobre equilibrio', breakeven === null ? '—' : `${num((observed - breakeven) * 100, 1)} pp`],
    ['Ganadoras / perdedoras', `${s.wins.length} / ${s.losses.length}`],
    ['Operaciones a cero', s.scratches.length], ['Risk/Reward planificado', 'N/D', '', 'Requiere stop y objetivo iniciales']
  ].map(item => metric(...item)).join('');
  $('ratio-table').innerHTML = tableMarkup(['Dirección', 'Operaciones', 'Win rate', 'Ganancia / pérdida', 'Profit factor', 'Esperanza'], ['BUY', 'SELL'].map(side => {
    const subset = rows.filter(t => t.side === side), stats = statistics(subset);
    return [side === 'BUY' ? 'Long' : 'Short', subset.length, pct(stats.wins.length, subset.length), stats.wins.length && stats.losses.length ? `${num(stats.payOff)} : 1` : '—', ratioValue(stats.pf), subset.length ? money(stats.expectancy) : '—'];
  }));
  $('breakeven-table').innerHTML = tableMarkup(['Ganancia / pérdida', 'Acierto de equilibrio', 'Tu acierto sin ceros', 'Margen'], [0.5, 1, 1.5, 2, 3, 4].map(ratio => {
    const threshold = 1 / (1 + ratio);
    return [`${ratio} : 1`, `${num(threshold * 100, 1)}%`, pct(s.wins.length, decisive), observed === null ? '—' : `${num((observed - threshold) * 100, 1)} pp`];
  }));
}

function renderCalendar(rows) {
  if (!$('calendar-month').value) $('calendar-month').value = (rows.at(-1)?.date || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())).slice(0, 7);
  const month = $('calendar-month').value;
  if (!/^\d{4}-\d{2}$/.test(month)) return;
  const [year, number] = month.split('-').map(Number);
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const offset = (new Date(Date.UTC(year, number - 1, 1)).getUTCDay() + 6) % 7;
  const monthRows = rows.filter(t => t.date.startsWith(month));
  const daily = new Map(group(monthRows, t => t.date));
  $('calendar-summary').textContent = `${monthRows.length} operaciones · ${daily.size} sesiones · PnL ${signed(sum(monthRows))}`;
  let html = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(day => `<div class="calendar-weekday">${day}</div>`).join('');
  html += '<div class="calendar-blank" aria-hidden="true"></div>'.repeat(offset);
  for (let day = 1; day <= count; day++) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    const trades = monthRows.filter(t => t.date === date);
    const pnl = daily.get(date);
    html += `<button type="button" class="calendar-day ${trades.length ? cssSign(pnl) : 'inactive'}" data-day="${date}" aria-pressed="${selectedCalendarDay === date}" ${trades.length ? '' : 'disabled'} aria-label="${date}, ${trades.length} operaciones${trades.length ? `, ${esc(signed(pnl))}` : ''}"><span>${day}</span>${trades.length ? `<strong>${esc(signed(pnl))}</strong><small>${trades.length} trades</small>` : '<small>—</small>'}</button>`;
  }
  $('calendar-grid').innerHTML = html;
  const selected = rows.filter(t => t.date === selectedCalendarDay && t.date.startsWith(month));
  $('calendar-selection').textContent = selected.length ? `${selectedCalendarDay} · ${selected.length} operaciones · ${signed(sum(selected))}` : 'Selecciona un día operado para ver sus operaciones.';
  $('calendar-trades').innerHTML = selected.length ? tableMarkup(['Símbolo', 'Dirección', 'Apertura NY', 'Cierre NY', 'PnL'], selected.map(t => [t.symbol, t.side === 'BUY' ? 'Long' : 'Short', t.opened.slice(11, 19), t.closed.slice(11, 19), signed(t.pnl)])) : '';
  const weeks = groupedStatistics(monthRows, trade => {
    const date = new Date(`${trade.date}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    return date.toISOString().slice(0, 10);
  }).sort((a, b) => a[0].localeCompare(b[0]));
  $('weekly-table').innerHTML = weeks.length ? breakdownTable(weeks.map(([start, trades]) => [`Semana del ${start}`, trades])) : '<p class="muted">Sin operaciones en este mes.</p>';
}

function comparisonRows(key) {
  const from = $(`compare-${key}-from`).value, to = $(`compare-${key}-to`).value;
  const side = $(`compare-${key}-side`).value, symbol = $(`compare-${key}-symbol`).value;
  if (from && to && from > to) return null;
  return filtered.filter(t => (!from || t.date >= from) && (!to || t.date <= to) && (side === 'all' || t.side === side) && (symbol === 'all' || t.symbol === symbol));
}

function renderComparisons() {
  if (!dataset) return;
  const a = comparisonRows('a'), b = comparisonRows('b');
  $('compare-status').textContent = a === null || b === null ? 'Revisa las fechas: Desde debe ser anterior o igual a Hasta.' : `Grupo A: ${a.length} operaciones · Grupo B: ${b.length} operaciones. Los grupos pueden contener operaciones comunes.`;
  if (a === null || b === null) { $('compare-table').innerHTML = ''; $('compare-chart').innerHTML = ''; return; }
  const summaries = [a, b].map(rows => statistics(rows));
  const measures = [
    ['Operaciones', (_, rows) => rows.length], ['PnL', s => signed(s.pnl)],
    ['Win rate', (s, rows) => pct(s.wins.length, rows.length)], ['Profit factor', s => ratioValue(s.pf)],
    ['Ganancia / pérdida', s => s.wins.length && s.losses.length ? `${num(s.payOff)} : 1` : '—'],
    ['Esperanza / operación', (s, rows) => rows.length ? money(s.expectancy) : '—'],
    ['Drawdown máximo', s => money(s.tradeStats.biggest)], ['Días operados', s => s.daily.length]
  ];
  $('compare-table').innerHTML = tableMarkup(['Métrica', 'Grupo A', 'Grupo B'], measures.map(([label, fn]) => [label, fn(summaries[0], a), fn(summaries[1], b)]));
  const axis = dates([...a, ...b]);
  $('compare-chart').innerHTML = svgChart([{ values: alignedEquity(a, axis), color: '#20d07a' }, { values: alignedEquity(b, axis), color: '#ff4e62' }], { currency: true, title: 'Comparación de capital por fecha' });
}

function initializeWorkspace() {
  activateView();
  window.addEventListener('hashchange', () => {
    activateView();
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  const selectAnalysis = key => {
    document.querySelectorAll('[data-analysis-panel]').forEach(panel => { panel.hidden = panel.dataset.analysisPanel !== key; });
    document.querySelectorAll('[data-analysis]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.analysis === key)));
  };
  selectAnalysis('time');
  document.querySelectorAll('[data-analysis]').forEach(button => button.addEventListener('click', () => selectAnalysis(button.dataset.analysis)));
  $('calendar-month').addEventListener('change', () => { selectedCalendarDay = ''; renderCalendar(filtered); });
  for (const [id, step] of [['month-prev', -1], ['month-next', 1]]) $(id).addEventListener('click', () => {
    const value = $('calendar-month').value;
    if (!value) return;
    const [year, month] = value.split('-').map(Number);
    $('calendar-month').value = new Date(Date.UTC(year, month - 1 + step, 1)).toISOString().slice(0, 7);
    selectedCalendarDay = ''; renderCalendar(filtered);
  });
  $('calendar-grid').addEventListener('click', event => {
    const button = event.target.closest('[data-day]');
    if (!button || button.disabled) return;
    selectedCalendarDay = button.dataset.day; renderCalendar(filtered);
  });
  for (const key of ['a', 'b']) for (const field of ['from', 'to', 'side', 'symbol']) $(`compare-${key}-${field}`).addEventListener('change', renderComparisons);
}
