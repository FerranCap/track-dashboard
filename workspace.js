'use strict';

const VIEW_DETAILS = {
  general: ['General', 'Actividad y resultados, de un vistazo.'],
  calendar: ['Calendario', 'Resultados por sesión y evolución mensual.'],
  compare: ['Comparativas', 'Compara hasta seis grupos de operaciones con filtros independientes.'],
  price: ['Precio', 'Resultados por rango de precio de entrada.'],
  duration: ['Duración', 'Resultados según el tiempo de permanencia en cada operación.'],
  growth: ['Relativo', 'Evolución del beneficio y del movimiento del PnL por operación.'],
  ratios: ['Ratios', 'Acierto, beneficio medio y relación entre ganancias y pérdidas.'],
  risk: ['Consistencia', 'Caídas de capital, rachas y estabilidad de los resultados.'],
  country: ['País', 'Estudia tu operativa por país de la empresa emisora.'],
  data: ['Tickers', 'Detecta tickers nuevos y datos pendientes en la base de emisores.'],
  trades: ['Operaciones', 'Consulta y estudia tus operaciones individuales.']
};
let selectedCalendarDay = '';
let issuerAudit = null;

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
  $('data-selection').hidden = active === 'data' || active === 'compare';
  refreshCharts();
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
  const headers = ['Grupo', 'Operaciones', 'Win rate', 'PnL', 'PnL medio', 'Profit factor'];
  return tableMarkup(headers, groups.map(([name, rows]) => {
    const s = statistics(rows);
    const values = [name, rows.length, pct(s.wins.length, rows.length), signed(s.pnl), rows.length ? money(s.expectancy) : '—', ratioValue(s.pf)];
    return values;
  }));
}

function ratioValue(value) {
  return value === Infinity ? '∞' : num(value);
}

function renderRecentSessions(daily) {
  const count = $('recent-session-count').value;
  const values = count === 'all' ? daily : daily.slice(-Number(count));
  const title = count === 'all' ? 'Todas las sesiones' : `Últimas ${count} sesiones`;
  renderChart('recent-chart', [{ values }], {
    bar: true, currency: true, title,
    explanation: `${HELP_PNL} Cada barra suma el PnL por fecha de cierre en Nueva York. Se muestran ${count === 'all' ? 'todas las sesiones con operaciones' : `las últimas ${count} sesiones con operaciones disponibles`} dentro de los filtros actuales, en orden cronológico.`
  });
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
  renderRecentSessions(s.daily);
  renderDurationStudies(rows);
  renderCountries(rows);
  renderRatios(rows);
  renderCalendar(rows);
  renderComparisons();
  renderConsistencyStudies(rows);
  renderGrowth(rows);
}

function growthPeriods(rows) {
  const valuesByMonth = new Map();
  for (const trade of rows) {
    const month = trade.date.slice(0, 7);
    if (!valuesByMonth.has(month)) valuesByMonth.set(month, []);
    if (Number.isFinite(trade.pnl)) valuesByMonth.get(month).push(Math.abs(trade.pnl));
  }
  let cumulative = 0;
  return periodConsistency(rows, 'month').map(period => {
    cumulative += period.pnl;
    const values = valuesByMonth.get(period.period);
    return { ...period, cumulative,
      meanAbsolutePnl: values.length ? mean(values) : null,
      medianAbsolutePnl: sampleQuantile(values, 0.5) };
  });
}

function growthTradePoints(rows, limit) {
  const ordered = chronologicalTrades(rows).filter(trade => Number.isFinite(trade.pnl));
  const count = [50, 100, 250].includes(Number(limit)) ? Number(limit) : ordered.length;
  const offset = Math.max(0, ordered.length - count);
  return ordered.slice(offset).map((trade, index) => ({ trade, number: offset + index + 1, absolute: Math.abs(trade.pnl) }));
}

function renderGrowthTradeChart(rows) {
  const points = growthTradePoints(rows, $('growth-trade-window').value);
  const count = rows.filter(trade => Number.isFinite(trade.pnl)).length;
  const explanation = 'Cada barra representa un trade individual en orden de cierre y su altura es |PnL final registrado| en USD. No se promedia ni se agrupa por meses. Un trade de −$25 se muestra con altura $25; su resultado con signo aparece en la ayuda. No representa máximos, mínimos ni recorrido intratrade.';
  $('growth-trade-count').textContent = points.length ? `Trades ${points[0].number}–${points.at(-1).number} de ${count} con los filtros actuales. Una barra por operación; desplaza horizontalmente para recorrerlas.` : 'Sin operaciones para estos filtros.';
  $('growth-absolute-pnl-chart').style.minWidth = points.length ? `${Math.max(300, points.length * 9 + 100)}px` : '0';
  renderChart('growth-absolute-pnl-chart', [{ values: points.map(({ trade, number, absolute }) => [
    `Trade #${number} · ${trade.symbol} · ${trade.closed}`, absolute,
    `PnL original: ${signed(trade.pnl)}. Valor absoluto: ${money(absolute)}. Cierre: ${trade.closed}. Identificador: ${trade.id}.`
  ]), color: '#5c9bff' }], { currency: true, bar: true, labels: points.map(point => `#${point.number}`), title: 'Valor absoluto del PnL de cada trade', explanation });
}

function renderGrowth(rows) {
  const periods = growthPeriods(rows);
  const pnls = rows.map(trade => trade.pnl).filter(Number.isFinite);
  const absolutePnls = pnls.map(Math.abs);
  $('growth-stats').innerHTML = [
    ['Beneficio acumulado', rows.length ? signed(sum(rows)) : '—', 'Suma del PnL de las operaciones cerradas filtradas, partiendo de cero. Las comisiones del CSV no se descuentan de nuevo; no es saldo de cuenta ni rentabilidad porcentual.'],
    ['PnL medio por trade', pnls.length ? signed(mean(pnls)) : '—', 'Suma del PnL de los trades ÷ número de trades. Se mantiene el signo y se incluyen los trades a cero. Cada operación pesa igual. Se expresa en USD y no se divide por precio ni por shares.'],
    ['PnL absoluto medio por trade', absolutePnls.length ? money(mean(absolutePnls)) : '—', 'Media de |PnL|, tomando primero el valor absoluto de cada trade. Ejemplo: +$10 y −$6 dan ($10 + $6) ÷ 2 = $8. Ganancias y pérdidas no se cancelan. Una magnitud mayor también puede proceder de pérdidas mayores.'],
    ['PnL absoluto mediano por trade', absolutePnls.length ? money(sampleQuantile(absolutePnls, 0.5)) : '—', 'Mediana de los valores |PnL| de cada trade, en dólares. Reduce la influencia de operaciones excepcionalmente grandes. No utiliza precio de la acción ni cantidad de shares.']
  ].map(args => consistencyMetric(...args)).join('');
  renderChart('growth-cumulative-chart', [{ values: periods.map(period => [period.period, period.cumulative]), color: '#5c9bff' }], { currency: true, explanation: 'Suma acumulada del PnL de los meses observados, desde $0 al comienzo de los filtros. No incluye saldo inicial, depósitos ni retiradas y no representa una rentabilidad sobre capital.' });
  renderChart('growth-monthly-chart', [{ values: periods.map(period => [period.period, period.pnl]) }], { bar: true, currency: true, explanation: 'Suma del PnL de las operaciones cerradas en cada mes según Nueva York. Los meses sin operaciones se omiten; el primer y último mes pueden ser parciales.' });
  renderGrowthTradeChart(rows);
  renderChart('growth-average-pnl-chart', [{ values: periods.map(period => [period.period, period.average]), color: '#5c9bff' }], { currency: true, bar: true, explanation: 'PnL total del mes ÷ número de trades cerrados del mes. Se conserva el signo: ganancias y pérdidas pueden cancelarse. No utiliza precio de entrada ni cantidad de shares.' });
  $('growth-monthly-table').innerHTML = periods.length ? tableMarkup(['Mes', 'Operaciones', 'PnL', 'Beneficio acumulado', 'Variación del beneficio · USD', 'PnL medio por trade', 'PnL absoluto medio por trade', 'PnL absoluto mediano por trade', 'Variación PnL absoluto medio · USD'], periods.map((period, index) => {
    const previous = periods[index - 1];
    const movementChange = previous && previous.meanAbsolutePnl !== null && period.meanAbsolutePnl !== null ? period.meanAbsolutePnl - previous.meanAbsolutePnl : null;
    return [period.period, period.count, signed(period.pnl), signed(period.cumulative), previous ? signed(period.pnl - previous.pnl) : '—', signed(period.average), money(period.meanAbsolutePnl), money(period.medianAbsolutePnl), movementChange === null ? '—' : signed(movementChange)];
  })) : '<p class="muted">Sin operaciones para estos filtros.</p>';
}

function incorporationCountry(profile) {
  const value = typeof profile?.incorporation_country === 'string' ? profile.incorporation_country.trim() : '';
  return ['unknown', 'unverified', 'n/a', 'n/d', 'sin confirmar', 'sin clasificar', '—', '-'].includes(value.toLowerCase()) ? '' : value;
}

function tradeCountry(trade) {
  return incorporationCountry(dataset?.tickerProfiles?.[trade.symbol]);
}

function renderCountries(rows) {
  const countryOf = tradeCountry;
  const groups = groupedStatistics(rows, t => countryOf(t) || 'Sin clasificar');
  $('country-table').innerHTML = groups.length ? breakdownTable(groups) : '<p class="muted">Sin operaciones para estos filtros.</p>';
  renderChart('country-chart',[{ values: groups.map(([name, trades]) => [name, sum(trades)]), color: '#5c9bff' }], { bar: true, currency: true, title: 'PnL por país de constitución', explanation: `${HELP_PNL} Se agrupa exclusivamente por país de constitución. La operación principal, sede, ADR y VIE son informativos y no afectan a esta agrupación. Solo la ausencia del país de constitución genera Sin clasificar.` });
}

function renderIssuerProfiles(rows) {
  const symbols = new Set(rows.map(trade => trade.symbol));
  const query = $('issuer-search').value.toLowerCase().trim();
  const profiles = Object.values(dataset?.tickerProfiles || {}).filter(profile => symbols.has(profile.symbol) && (!query || `${profile.symbol} ${profile.issuer_name}`.toLowerCase().includes(query))).sort((a, b) => a.symbol.localeCompare(b.symbol));
  const known = profiles.filter(profile => incorporationCountry(profile)).length;
  const checked = [...new Set(profiles.map(profile => profile.checked_on).filter(Boolean))].sort().at(-1);
  $('issuer-count').textContent = `${profiles.length} emisores · ${known} con país de constitución identificado${checked ? ` · Consulta de fuentes: ${checked}` : ''}`;
  const status = { explicit_filing: 'Declaración en documento', reviewed: 'Revisión documentada', facilities_inference: 'Inferido por instalaciones', unverified: 'Pendiente' };
  const security = { direct_equity: 'Acciones directas', ADS: 'ADS / ADR', unknown: 'Sin confirmar' };
  const sourceLink = (url, label) => /^https:\/\/(?:www\.|data\.)sec\.gov\//.test(url || '') ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : '';
  $('issuer-table').innerHTML = profiles.length ? `<table><thead><tr>${['Ticker', 'Emisor', 'Constitución', 'País de operación', 'Valor cotizado', 'Noticias', 'Fuentes'].map(label => `<th tabindex="0" ${helpAttributes(helpText(label))}>${esc(label)}<span class="help-mark" aria-hidden="true">&#9432;</span></th>`).join('')}</tr></thead><tbody>${profiles.map(profile => `<tr><td><strong>${esc(profile.symbol)}</strong></td><td class="issuer-name">${esc(profile.issuer_name)}<small>CIK ${esc(profile.cik || 'Pendiente')}</small></td><td>${esc(profile.incorporation_country || 'Sin confirmar')}<small>${esc(profile.incorporation_jurisdiction)}</small></td><td>${esc(profile.operating_country || 'Sin confirmar')}<small class="${profile.operations_status === 'facilities_inference' ? 'warning' : 'muted'}">${esc(status[profile.operations_status] || 'Pendiente')}</small><details><summary>Detalle</summary><p>Sede declarada: ${esc(profile.headquarters_country || 'Sin confirmar')}. ${esc(profile.operations_basis || 'No se ha establecido un país principal de operación.')} ${esc(profile.historical_note)}</p></details></td><td ${helpAttributes(profile.security_basis || 'Tipo de valor pendiente de confirmar.')}>${esc(security[profile.security_type] || 'Sin confirmar')}</td>${issuerNewsCell(profile)}<td>${sourceLink(profile.source_profile_url, 'Ficha SEC')}<br>${sourceLink(profile.source_filing_url, `Documento ${profile.source_filing_date || ''}`)}<small>Consulta ${esc(profile.checked_on)}</small></td></tr>`).join('')}</tbody></table>` : '<p class="muted">No hay emisores para estos filtros.</p>';
}

function auditIssuerData(source) {
  const symbols = new Map();
  const assigned = value => typeof value === 'string' && value.trim() && !['unknown', 'unverified', 'n/a', 'n/d', 'sin confirmar', 'sin clasificar', '—', '-'].includes(value.trim().toLowerCase());
  for (const trade of source.trades) {
    const symbol = String(trade.symbol || '').trim().toUpperCase();
    if (!symbol) continue;
    if (!symbols.has(symbol)) symbols.set(symbol, { symbol, count: 0, first: trade.date, last: trade.date });
    const entry = symbols.get(symbol);
    entry.count++;
    if (trade.date < entry.first) entry.first = trade.date;
    if (trade.date > entry.last) entry.last = trade.date;
  }
  return [...symbols.values()].sort((a, b) => a.symbol.localeCompare(b.symbol)).map(entry => {
    const profile = source.tickerProfiles?.[entry.symbol];
    const missingProfile = !profile;
    const country = !incorporationCountry(profile);
    const incorporation = country || !assigned(profile?.incorporation_jurisdiction);
    const operations = !assigned(profile?.operating_country) || !['explicit_filing', 'reviewed'].includes(profile?.operations_status);
    const security = !['direct_equity', 'ADS'].includes(profile?.security_type);
    const vie = !['yes_explicit', 'no_explicit'].includes(profile?.vie_status);
    const fields = [
      ...(missingProfile ? ['Ficha de emisor'] : []),
      ...(country ? ['País de constitución'] : !assigned(profile?.incorporation_jurisdiction) ? ['Jurisdicción de constitución (informativo)'] : []),
      ...(operations ? [profile?.operations_status === 'facilities_inference' ? 'País de operación (solo inferido)' : 'País de operación confirmado'] : []),
      ...(security ? ['Tipo de valor: acciones o ADS/ADR'] : []),
      ...(vie ? ['Confirmación de VIE'] : [])
    ];
    return { ...entry, profile, missingProfile, country, incorporation, operations, security, vie, fields };
  });
}

function renderDataAudit() {
  if (!dataset) return;
  issuerAudit = auditIssuerData(dataset);
  $('data-audit-stats').innerHTML = [
    ['Tickers del historial', issuerAudit.length],
    ['Tickers identificados', issuerAudit.filter(entry => !entry.country).length],
    ['Tickers sin identificar', issuerAudit.filter(entry => entry.country).length],
    ['Tickers sin ficha', issuerAudit.filter(entry => entry.missingProfile).length],
  ].map(item => metric(...item)).join('');
  const checked = new Date().toLocaleString('es-ES', { timeZone: 'America/New_York' });
  const generated = new Date(dataset.generatedAt).toLocaleString('es-ES', { timeZone: 'America/New_York' });
  $('data-audit-status').textContent = `Comprobado: ${checked} (Nueva York). Datos publicados: ${generated}. Un ticker está identificado si tiene país de constitución. La jurisdicción detallada, operación, sede, tipo de valor y VIE se conservan como información adicional y no afectan a esa identificación.`;
  $('data-check-pending').disabled = false;
  renderPendingIssuers();
  renderIssuerProfiles(dataset.trades);
}

function renderPendingIssuers() {
  if (!issuerAudit) return;
  const query = $('data-pending-search').value.trim().toLowerCase();
  const kind = $('data-pending-kind').value;
  const pending = issuerAudit.filter(entry => entry.country);
  $('data-pending-panel').hidden = pending.length === 0;
  $('data-audit-complete').hidden = issuerAudit.length === 0 || pending.length > 0;
  const matches = pending.filter(entry => {
    const typeMatch = kind === 'new' ? entry.missingProfile : entry.country;
    return typeMatch && (!query || `${entry.symbol} ${entry.profile?.issuer_name || ''}`.toLowerCase().includes(query));
  }).sort((a, b) => Number(b.missingProfile) - Number(a.missingProfile) || a.symbol.localeCompare(b.symbol));
  $('data-pending-count').textContent = `${matches.length} mostrados · ${pending.length} sin país de constitución · ${issuerAudit.length} en el historial`;
  $('data-pending-table').innerHTML = matches.length ? `<table><thead><tr><th>Ticker</th><th>Emisor</th><th>País de constitución</th><th>Estado</th><th>Datos pendientes</th><th>Operaciones</th><th>Primera operación</th><th>Última operación</th></tr></thead><tbody>${matches.map(entry => `<tr><td><strong>${esc(entry.symbol)}</strong></td><td class="issuer-name">${esc(entry.profile?.issuer_name || 'Sin ficha en la base')}</td><td>${esc(entry.profile?.incorporation_country || 'Sin confirmar')}<small>${esc(entry.profile?.incorporation_jurisdiction || '')}</small></td><td class="warning">${entry.missingProfile ? 'Ticker nuevo / sin ficha' : 'País de constitución sin identificar'}</td><td class="pending-fields"><span>País de constitución</span></td><td>${entry.count}</td><td>${esc(entry.first)}</td><td>${esc(entry.last)}</td></tr>`).join('')}</tbody></table>` : `<p class="muted">${pending.length ? 'No hay tickers pendientes que coincidan con esta búsqueda y tipo de pendiente.' : 'Todos los tickers del historial tienen su país de constitución identificado.'}</p>`;
}

async function checkPendingIssuers() {
  $('data-check-pending').disabled = true;
  $('data-audit-status').textContent = 'Cargando los últimos datos publicados y comprobando los tickers…';
  try {
    if (await loadData({ preserveFilters: true })) {
      location.hash = '#data';
      activateView();
    } else {
      $('data-audit-status').textContent = 'No se ha podido actualizar la comprobación. La lista anterior se conserva; revisa el error de carga e inténtalo de nuevo.';
    }
  } finally {
    $('data-check-pending').disabled = !dataset;
  }
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
  renderRatioStudies(rows);
}

function ratioStudyGroups(rows, key) {
  const minimum = Math.max(1, Math.ceil(Number($('ratio-min-trades').value) || 1));
  return groupedStatistics(rows, key).filter(([, trades]) => trades.length >= minimum).map(([name, trades]) => {
    const stats = statistics(trades);
    return { name, count: trades.length, stats, rr: stats.wins.length && stats.losses.length ? stats.payOff : null };
  });
}

function renderRatioStudy(prefix, groups) {
  const headers = ['Grupo', 'Operaciones', 'Ganadoras', 'Perdedoras', 'A cero', 'Win rate', 'Ganancia media', 'Pérdida media', 'RR realizado', 'Profit factor', 'Esperanza', 'Muestra'];
  $(`${prefix}-table`).innerHTML = groups.length ? tableMarkup(headers, groups.map(({ name, count, stats: s, rr }) => [
    name, count, s.wins.length, s.losses.length, s.scratches.length, pct(s.wins.length, count),
    s.wins.length ? money(s.winAvg) : '—', s.losses.length ? money(s.lossAvg) : '—',
    rr === null ? '—' : `${num(rr)} : 1`, ratioValue(s.pf), money(s.expectancy), count < 20 ? 'Reducida (<20)' : '20 o más'
  ])) : '<p class="muted">Sin grupos con el mínimo de operaciones seleccionado.</p>';
  renderChart(`${prefix}-winrate`, [{ values: groups.map(g => [g.name, 100 * g.stats.wins.length / g.count, `${g.stats.wins.length} ganadoras ÷ ${g.count} operaciones × 100. Incluye ${g.stats.scratches.length} a cero.${g.count < 20 ? ' Muestra reducida (<20).' : ''}`]), color: '#5c9bff' }], { bar: true, unit: '%', max: 100, title: 'Win rate por grupo' });
  renderChart(`${prefix}-rr`, [{ values: groups.filter(g => g.rr !== null).map(g => [g.name, g.rr, `Cálculo: ${money(g.stats.winAvg)} de ganancia media ÷ ${money(Math.abs(g.stats.lossAvg))} de pérdida media absoluta. ${g.stats.wins.length} ganadoras y ${g.stats.losses.length} perdedoras; ${g.stats.scratches.length} a cero excluidas del RR.${g.count < 20 ? ' Muestra reducida (<20).' : ''}`]), color: '#a68afb' }], { bar: true, unit: 'x', title: 'Relación ganancia media / pérdida media por grupo', empty: 'RR no disponible: cada grupo necesita operaciones ganadoras y perdedoras.' });
}

function renderRatioStudies(rows) {
  const selected = Number($('ratio-time-interval').value);
  const interval = [5, 30, 60].includes(selected) ? selected : 5;
  const groups = ratioStudyGroups(rows, trade => timeBand(trade, interval) || 'Sin horario').sort((a, b) => a.name.localeCompare(b.name));
  renderRatioStudy('ratio-time', groups);
  const countries = ratioStudyGroups(rows, trade => tradeCountry(trade) || 'Sin clasificar').sort((a, b) => a.name.localeCompare(b.name));
  const known = rows.filter(tradeCountry).length;
  $('ratio-country-note').textContent = `País de constitución · ${known} de ${rows.length} operaciones clasificadas. Solo los tickers sin país de constitución identificado quedan Sin clasificar. Se aplica el mismo mínimo de operaciones que al estudio horario.`;
  renderRatioStudy('ratio-country', countries);
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
    html += `<button type="button" class="calendar-day ${trades.length ? cssSign(pnl) : 'inactive'}" data-day="${date}" ${helpAttributes(`${date}: ${trades.length} operaciones. Se suma el PnL de las operaciones cerradas este día en Nueva York. Selecciona el día para consultar sus operaciones. ${HELP_PNL}`)} aria-pressed="${selectedCalendarDay === date}" ${trades.length ? '' : 'disabled'} aria-label="${date}, ${trades.length} operaciones${trades.length ? `, ${esc(signed(pnl))}` : ''}"><span>${day}</span>${trades.length ? `<strong>${esc(signed(pnl))}</strong><small>${trades.length} trades</small>` : '<small>—</small>'}</button>`;
  }
  $('calendar-grid').innerHTML = html;
  renderCalendarOverview(rows, month);
  const selected = rows.filter(t => t.date === selectedCalendarDay && t.date.startsWith(month));
  $('calendar-selection').textContent = selected.length ? `${selectedCalendarDay} · ${selected.length} operaciones · ${signed(sum(selected))}` : 'Selecciona un día operado para ver sus operaciones.';
  $('calendar-trades').innerHTML = selected.length ? tableMarkup(['Símbolo', 'Dirección', 'Apertura NY', 'Cierre NY', 'PnL'], selected.map(t => [t.symbol, t.side === 'BUY' ? 'Long' : 'Short', t.opened.slice(11, 19), t.closed.slice(11, 19), signed(t.pnl)])) : '';
  renderCalendarDay(selected);
}

function comparisonRows(key) {
  return tradeFilterPanels.get(key).matchingRows();
}

function renderComparisons() {
  if (!dataset) return;
  const groups = comparisonGroupList().map(group => ({ ...group, rows: comparisonRows(group.key) }));
  $('compare-status').textContent = `${groups.map(group => `${group.name}: ${group.rows.length} operaciones`).join(' · ')}. Los grupos pueden contener operaciones comunes.`;
  const summaries = groups.map(group => statistics(group.rows));
  const measures = [
    ['Operaciones', (_, rows) => rows.length], ['PnL', s => signed(s.pnl)],
    ['Win rate', (s, rows) => pct(s.wins.length, rows.length)], ['Profit factor', s => ratioValue(s.pf)],
    ['Ganancia / pérdida', s => s.wins.length && s.losses.length ? `${num(s.payOff)} : 1` : '—'],
    ['Esperanza / operación', (s, rows) => rows.length ? money(s.expectancy) : '—'],
    ['Drawdown máximo', s => money(s.tradeStats.biggest)], ['Días operados', s => s.daily.length]
  ];
  $('compare-table').innerHTML = tableMarkup(['Métrica', ...groups.map(group => group.name)], measures.map(([label, fn]) => [label, ...groups.map((group, index) => fn(summaries[index], group.rows))]));
  $('compare-table').querySelectorAll('thead th').forEach((header, index) => {
    if (index) header.style.color = groups[index - 1].color;
  });
  $('compare-table').querySelectorAll('tbody tr').forEach((row, index) => {
    row.querySelectorAll('td').forEach((cell, column) => {
      cell.classList.remove('positive', 'negative');
      if (index === 1 && column) {
        const sign = cssSign(summaries[column - 1].pnl);
        if (sign) cell.classList.add(sign);
      }
    });
  });
  const axis = dates(groups.flatMap(group => group.rows));
  renderChart('compare-chart', groups.map(group => ({ values: alignedEquity(group.rows, axis), color: group.color })), { currency: true, title: 'Comparación de capital por fecha' });
  $('compare-legend').innerHTML = groups.map(group => `<span style="color:${group.color}"><span class="group-color-dot" aria-hidden="true"></span>${group.name}</span>`).join('');
}

function initializeWorkspace() {
  activateView();
  $('data-selection-toggle').addEventListener('click', () => {
    const button = $('data-selection-toggle');
    const expanded = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(expanded));
    $('global-filters').hidden = !expanded;
    refreshCharts();
  });
  window.addEventListener('hashchange', () => {
    activateView();
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  $('data-check-pending').addEventListener('click', checkPendingIssuers);
  $('data-pending-search').addEventListener('input', renderPendingIssuers);
  $('data-pending-kind').addEventListener('change', renderPendingIssuers);
  $('growth-trade-window').addEventListener('change', () => renderGrowthTradeChart(filtered));
  $('recent-session-count').addEventListener('change', () => renderRecentSessions(statistics(filtered).daily));
  $('price-range-width').addEventListener('change', () => renderPrice(filtered));
  $('duration-range-width').addEventListener('change', () => renderDurationStudies(filtered));
  $('issuer-search').addEventListener('input', () => renderIssuerProfiles(dataset?.trades || []));
  for (const id of ['ratio-time-interval', 'ratio-min-trades']) $(id).addEventListener('change', () => renderRatioStudies(filtered));
  $('calendar-month').addEventListener('change', () => { selectedCalendarDay = ''; calendarOverviewEndMonth = ''; renderCalendar(filtered); });
  for (const [id, step] of [['month-prev', -1], ['month-next', 1]]) $(id).addEventListener('click', () => {
    const value = $('calendar-month').value;
    if (!value) return;
    const [year, month] = value.split('-').map(Number);
    $('calendar-month').value = new Date(Date.UTC(year, month - 1 + step, 1)).toISOString().slice(0, 7);
    selectedCalendarDay = ''; calendarOverviewEndMonth = ''; renderCalendar(filtered);
  });
  $('calendar-grid').addEventListener('click', event => {
    const button = event.target.closest('[data-day]');
    if (!button || button.disabled) return;
    selectedCalendarDay = selectedCalendarDay === button.dataset.day ? '' : button.dataset.day;
    renderCalendar(filtered);
  });
}
