'use strict';

let calendarOverviewEndMonth = '';

function renderCalendarResults(rows) {
  const period = $('calendar-results-period').value;
  const title = { month: 'Resultados mensuales', week: 'Resultados semanales', day: 'Resultados diarios' }[period];
  const scope = { month: 'mes de cierre en Nueva York', week: 'semana de cierre en Nueva York, de lunes a domingo', day: 'día de cierre en Nueva York' }[period];
  $('calendar-results-title').textContent = title;
  const groups = groupedStatistics(rows, trade => period === 'day' ? trade.date : consistencyPeriod(trade.date, period))
    .sort(([left], [right]) => left.localeCompare(right));
  const values = groups.map(([date, trades]) => [date, sum(trades)]);
  if (period === 'week') values.forEach(point => point.push(`Semana del ${point[0]} (lunes a domingo).`));
  renderChart('months-chart', [{ values, color: '#5c9bff' }], {
    bar: true, currency: true, title,
    explanation: `${HELP_PNL} Cada barra suma las operaciones agrupadas por ${scope}. Se aplican los filtros actuales; se omiten los periodos sin operaciones y los extremos pueden ser parciales.`
  });
  $('calendar-results-table').innerHTML = groups.length
    ? breakdownTable(groups.map(([date, trades]) => [period === 'week' ? `Semana del ${date}` : date, trades]))
    : '<p class="muted">Sin operaciones para estos filtros.</p>';
}

function shiftCalendarMonth(month, offset) {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1 + offset, 1)).toISOString().slice(0, 7);
}

function calendarMonthTitle(month) {
  return new Intl.DateTimeFormat('es-ES', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`));
}

function miniCalendarCells(month) {
  const [year, number] = month.split('-').map(Number);
  const offset = (new Date(Date.UTC(year, number - 1, 1)).getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(year, number - 1, index - offset + 1));
    return { date: date.toISOString().slice(0, 10), day: date.getUTCDate(), outside: date.getUTCMonth() !== number - 1 };
  });
}

function renderCalendarOverview(rows, month) {
  if (!calendarOverviewEndMonth) calendarOverviewEndMonth = month;
  const months = Array.from({ length: 6 }, (_, index) => shiftCalendarMonth(calendarOverviewEndMonth, -index));
  const daily = new Map(group(rows, trade => trade.date));
  const monthly = new Map(group(rows, trade => trade.date.slice(0, 7)));
  $('calendar-overview-range').textContent = `${calendarMonthTitle(months.at(-1))} — ${calendarMonthTitle(months[0])}`;
  $('calendar-mini-months').innerHTML = months.map(value => {
    const total = monthly.get(value);
    const cells = miniCalendarCells(value).map(cell => {
      const pnl = daily.get(cell.date);
      const active = !cell.outside && pnl !== undefined;
      return `<button type="button" class="mini-calendar-day ${cell.outside ? 'outside' : active ? cssSign(pnl) : 'inactive'}" data-mini-day="${cell.date}" aria-pressed="${selectedCalendarDay === cell.date && !cell.outside}" ${active ? '' : 'disabled'} aria-label="${cell.date}${active ? `, PnL ${esc(signed(pnl))}` : ', sin operaciones en este mes'}" ${helpAttributes(active ? `${cell.date}: PnL ${signed(pnl)}. Suma de trades cerrados este día en Nueva York, con los filtros actuales. Pulsa para seleccionar el día.` : `${cell.date}: sin operaciones en este mes con los filtros actuales.`)}>${cell.day}</button>`;
    }).join('');
    return `<section class="mini-calendar"><div class="mini-calendar-heading"><button type="button" data-mini-month="${value}" aria-label="Mostrar ${esc(calendarMonthTitle(value))}">${esc(calendarMonthTitle(value))}</button><strong class="${total === undefined ? 'muted' : cssSign(total)}" ${helpAttributes(`${calendarMonthTitle(value)}: ${total === undefined ? 'sin operaciones' : `PnL ${signed(total)}`}. Suma de trades cerrados en este mes, con los filtros actuales.`)}>${total === undefined ? '—' : esc(signed(total))}</strong></div><div class="mini-calendar-grid">${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(day => `<span class="mini-calendar-weekday">${day}</span>`).join('')}${cells}</div></section>`;
  }).join('');
}

function calendarMetricRows(rows, scope, pnlLabel = 'PnL', includeDirections = true) {
  const stats = statistics(rows);
  const long = rows.filter(trade => trade.side === 'BUY'), short = rows.filter(trade => trade.side === 'SELL');
  return [
    ['Operaciones', String(rows.length), 'Número de trades cerrados únicos. Las ejecuciones parciales no se cuentan como trades adicionales.'],
    ['Win rate', pct(stats.wins.length, rows.length), `${stats.wins.length} ganadoras ÷ ${rows.length} trades × 100. Incluye ${stats.scratches.length} trades a cero en el denominador.`],
    [pnlLabel, signed(stats.pnl), 'Suma del PnL registrado. Se conservan los costes incluidos en el dato original y no se restan las comisiones de nuevo.'],
    ['Comisiones', money(stats.fees), 'Suma de Commission de las ejecuciones únicas. Es un desglose informativo de los costes registrados; no se vuelve a descontar del PnL.'],
    ['Profit factor', ratioValue(stats.pf), 'Suma de PnL positivos ÷ valor absoluto de la suma de PnL negativos. Sin pérdidas y con ganancias se muestra ∞; sin resultados calculables se muestra —.'],
    ...(includeDirections ? [['Long', long.length ? signed(sum(long)) : '—', 'Suma del PnL de los trades BUY (Long).'],
    ['Short', short.length ? signed(sum(short)) : '—', 'Suma del PnL de los trades SELL (Short).']] : [])
  ].map(([label, value, explanation]) => [label, value, `${scope}. ${explanation} Se aplican los filtros generales.`]);
}

function calendarPnlCurve(rows) {
  if (!rows.length) return [];
  const ordered = chronologicalTrades(rows), date = rows[0].date;
  const firstOpen = ordered.reduce((earliest, trade) => Date.parse(trade.opened) < Date.parse(earliest) ? trade.opened : earliest, ordered[0].opened);
  const start = firstOpen.startsWith(date) ? firstOpen : `${date}T00:00:00${ordered[0].closed.slice(-6)}`;
  let equity = 0;
  return [[start, 0, 'Inicio del PnL en $0.'], ...ordered.map(trade => {
    equity += trade.pnl;
    return [trade.closed, equity, `${trade.symbol} ${trade.side === 'BUY' ? 'Long' : 'Short'}: trade ${signed(trade.pnl)}. PnL acumulado ${signed(equity)}.`];
  })];
}

function renderCalendarPnlChart(id, rows, scope) {
  const points = calendarPnlCurve(rows);
  renderChart(id, [{ values: points, color: '#29d17e' }], { currency: true, labels: points.map(point => point[0].slice(11, 19)), explanation: `${scope}. Suma acumulada del PnL de los trades cerrados, empezando en $0 y ordenados por instante de cierre. El eje horizontal avanza por cierres, no proporcionalmente al tiempo. No muestra precios intratrade ni ejecuciones parciales. Las comisiones incluidas no se descuentan otra vez.` });
}

function renderCalendarDay(rows) {
  for (const id of chartConfigs.keys()) if (id.startsWith('calendar-ticker-chart-')) chartConfigs.delete(id);
  const hasTrades = rows.length > 0;
  $('calendar-day-summary').hidden = !hasTrades;
  $('calendar-day-preview').hidden = !hasTrades;
  $('calendar-day-detail').hidden = !hasTrades;
  $('calendar-day-pnl').textContent = hasTrades ? `PnL ${signed(sum(rows))}` : '';
  $('calendar-day-pnl').className = hasTrades ? cssSign(sum(rows)) : '';
  if (!hasTrades) {
    $('calendar-symbol-cards').innerHTML = '';
    $('calendar-day-metrics').innerHTML = '';
    renderChart('calendar-day-chart', [], { currency: true, empty: 'Selecciona un día con operaciones.' });
    return;
  }
  const stats = statistics(rows);
  const date = rows[0].date;
  const title = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  $('calendar-preview-title').textContent = `Resumen — ${title}`;
  $('calendar-preview-totals').textContent = `${rows.length} trades · ${stats.wins.length} ganadoras / ${stats.losses.length} perdedoras / ${stats.scratches.length} a cero · PnL ${signed(stats.pnl)}`;
  $('calendar-selection').textContent = title;
  const tickerGroups = groupedStatistics(rows, trade => trade.symbol);
  $('calendar-symbol-cards').innerHTML = tickerGroups.map(([symbol, trades], index) => {
    const scope = `${symbol}, sesión del ${date}; solo sus ${trades.length} trades de este día`;
    const sides = ['BUY', 'SELL'].map(side => {
      const sample = trades.filter(trade => trade.side === side);
      if (!sample.length) return '';
      const label = side === 'BUY' ? 'Long' : 'Short';
      const sideStats = statistics(sample);
      const metrics = calendarMetricRows(sample, `${scope}; solo ${label}`, 'PnL', false).map(args => consistencyMetric(...args)).join('');
      return `<section class="calendar-ticker-side" aria-label="${esc(symbol)} ${label}"><h5 class="${side === 'BUY' ? 'long' : 'short'}">${label}</h5><p>${sideStats.wins.length} ganadoras / ${sideStats.losses.length} perdedoras / ${sideStats.scratches.length} a cero</p><div class="calendar-ticker-metrics">${metrics}</div></section>`;
    }).filter(Boolean);
    return `<article class="calendar-symbol-card"><div><h4>${esc(symbol)} <small>${trades.length} ${trades.length === 1 ? 'trade' : 'trades'}</small></h4><strong class="${cssSign(sum(trades))}" tabindex="0" ${helpAttributes(`${symbol}: suma del PnL de ${trades.length} trades cerrados el ${date}, con los filtros actuales. Las comisiones incluidas no se restan otra vez.`)}>${esc(signed(sum(trades)))}</strong></div><div class="calendar-ticker-side-groups${sides.length === 1 ? ' single-side' : ''}">${sides.join('')}</div><div class="calendar-ticker-equity"><h5>Curva de PnL · ${esc(symbol)}</h5><div id="calendar-ticker-chart-${index}" class="chart" role="img" aria-label="Curva de PnL de ${esc(symbol)} el ${date}"></div></div></article>`;
  }).join('');
  tickerGroups.forEach(([symbol, trades], index) => renderCalendarPnlChart(`calendar-ticker-chart-${index}`, trades, `${symbol}, sesión del ${date}; solo sus trades de este día`));
  $('calendar-day-metrics').innerHTML = calendarMetricRows(rows, `Sesión del ${date}; todos los tickers seleccionados`, 'PnL del día').map(args => consistencyMetric(...args)).join('');
  renderCalendarPnlChart('calendar-day-chart', rows, `Sesión del ${date}; todos los tickers seleccionados`);
}

function initializeCalendarOverview() {
  $('calendar-results-period').addEventListener('change', () => renderCalendarResults(filtered));
  for (const [id, step] of [['calendar-overview-prev', -6], ['calendar-overview-next', 6]]) {
    $(id).addEventListener('click', () => {
      calendarOverviewEndMonth = shiftCalendarMonth(calendarOverviewEndMonth || $('calendar-month').value, step);
      renderCalendarOverview(filtered, $('calendar-month').value);
    });
  }
  $('calendar-mini-months').addEventListener('click', event => {
    const day = event.target.closest('[data-mini-day]');
    if (day && !day.disabled) {
      selectedCalendarDay = selectedCalendarDay === day.dataset.miniDay ? '' : day.dataset.miniDay;
      $('calendar-month').value = day.dataset.miniDay.slice(0, 7);
      renderCalendar(filtered);
      return;
    }
    const month = event.target.closest('[data-mini-month]');
    if (month) {
      $('calendar-month').value = month.dataset.miniMonth;
      selectedCalendarDay = '';
      renderCalendar(filtered);
    }
  });
}
