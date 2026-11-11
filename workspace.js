'use strict';

const VIEW_DETAILS = {
  watchlist: ['Watchlist', ''],
  general: ['General', 'Actividad y resultados, de un vistazo.'],
  calendar: ['Calendario', 'Resultados por sesión y evolución mensual.'],
  compare: ['Comparativas', 'Compara hasta seis grupos de operaciones con filtros independientes.'],
  price: ['Precio', 'Resultados por rango de precio de entrada.'],
  duration: ['Duración', 'Resultados según el tiempo de permanencia en cada operación.'],
  growth: ['Relativo', 'Evolución de R y de la magnitud del PnL por operación.'],
  optimal: ['Óptimo', 'Estudio de riesgo y tamaño de posición sobre las operaciones filtradas.'],
  projection: ['Proyección', 'Escenarios a 12 meses basados en la R vigente y las operaciones filtradas.'],
  ratios: ['Ratios', 'Acierto, beneficio medio y relación entre ganancias y pérdidas.'],
  risk: ['Consistencia', 'Caídas de capital, rachas y estabilidad de los resultados.'],
  country: ['Localidad', 'Estudia tu operativa por país de la empresa emisora.'],
  data: ['Tickers', 'Detecta tickers nuevos y datos pendientes en la base de emisores.'],
  trades: ['Operaciones', 'Consulta y estudia tus operaciones individuales.']
};
let selectedCalendarDay = '';
let issuerAudit = null;
let sessionRiskHistory = [];
let pnlDisplayUnit = 'usd';

function displayPnlRows(rows, unit = pnlDisplayUnit, history = sessionRiskHistory) {
  if (unit === 'usd') return rows.map(trade => Object.hasOwn(trade, 'pnlUsd') ? { ...trade, pnl: trade.pnlUsd } : trade);
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
  return rows.flatMap(trade => {
    const opened = new Date(trade.opened);
    const date = Number.isFinite(opened.getTime()) ? formatter.format(opened) : null;
    const risk = trade.projectedRisk ?? (date ? sessionRiskAt(date, history)?.risk : null);
    const pnlUsd = trade.pnlUsd ?? trade.pnl;
    return Number.isFinite(risk) && risk > 0 && Number.isFinite(pnlUsd)
      ? [{ ...trade, pnl: pnlUsd / risk, pnlUsd, pnlRisk: risk }] : [];
  });
}

function initializePnlUnits() {
  const toggle = $('pnl-unit-toggle');
  try { if (localStorage.getItem('track-pnl-unit') === 'r') pnlDisplayUnit = 'r'; } catch {}
  const sync = () => {
    toggle.setAttribute('aria-checked', String(pnlDisplayUnit === 'usd'));
    document.querySelectorAll('[data-pnl-unit-label]').forEach(label => { label.textContent = pnlDisplayUnit === 'r' ? 'R' : 'USD'; });
    for (const id of ['growth-swing-unit', 'growth-projection-swing-unit']) $(id).value = pnlDisplayUnit;
  };
  sync();
  toggle.addEventListener('click', () => {
    pnlDisplayUnit = pnlDisplayUnit === 'usd' ? 'r' : 'usd';
    try { localStorage.setItem('track-pnl-unit', pnlDisplayUnit); } catch {}
    sync();
    applyFilters();
  });
}

async function fetchSessionRisk() {
  const response = await fetch(`data/session-risk.json?v=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Session risk history: HTTP ${response.status}`);
  const history = await response.json();
  if (!Array.isArray(history) || !history.length) throw new Error('Invalid session risk history.');
  const seen = new Set();
  for (const entry of history) {
    const date = entry.effectiveDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
      || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
      || !Number.isFinite(entry.risk) || entry.risk <= 0 || seen.has(date)) {
      throw new Error('Invalid or duplicate session risk entry.');
    }
    seen.add(date);
  }
  return history.slice().sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
}

function sessionRiskAt(date, history = sessionRiskHistory) {
  return history.filter(entry => entry.effectiveDate <= date).at(-1) || null;
}

function sessionRiskPoints(history, endDate) {
  const active = history.filter(entry => entry.effectiveDate <= endDate);
  const points = active.map(entry => [entry.effectiveDate, entry.risk]);
  const last = active.at(-1);
  if (last && last.effectiveDate < endDate) points.push([endDate, last.risk]);
  return points;
}

function renderSessionRisk() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const current = sessionRiskAt(today);
  $('growth-risk-current').textContent = current
    ? `R vigente: ${usdMoney(current.risk)} por sesión · desde ${current.effectiveDate}.`
    : 'Sin R definida para la fecha actual.';
  renderChart('growth-risk-chart', [{ values: sessionRiskPoints(sessionRiskHistory, today), color: '#5c9bff' }], {
    currency: true, currencyUnit: 'usd', step: true, timeAxis: true, title: 'Evolución de R por sesión', empty: 'Sin R definida para este período.',
    explanation: 'R en USD: pérdida máxima asumida por sesión, según los valores indicados por el usuario. Cada cambio se aplica desde su fecha de activación hasta el siguiente. La línea se mantiene hasta hoy en Nueva York. Historial completo, independiente de los filtros de operaciones.'
  });
  $('growth-risk-table').innerHTML = tableMarkup(['Fecha de activación', 'R · USD por sesión'], sessionRiskHistory.map(entry => [entry.effectiveDate, usdMoney(entry.risk)]));
}

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
  document.body.classList.toggle('watchlist-active', active === 'watchlist');
  $('data-selection').hidden = ['data', 'compare', 'watchlist'].includes(active);
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
    ['PnL medio / operación', rows.length ? money(s.expectancy) : '—'], ['Comisiones · USD', usdMoney(s.fees), '', 'Incluidas en el resultado; no se descuentan de nuevo'],
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
  renderGrowthProjection(rows);
  renderOptimal(rows);
}

function growthPeriods(rows, unit = 'month') {
  const valuesByPeriod = new Map();
  for (const trade of rows) {
    const period = consistencyPeriod(trade.date, unit);
    if (!valuesByPeriod.has(period)) valuesByPeriod.set(period, []);
    if (Number.isFinite(trade.pnl)) valuesByPeriod.get(period).push(Math.abs(trade.pnl));
  }
  let cumulative = 0;
  return periodConsistency(rows, unit).map(period => {
    cumulative += period.pnl;
    const values = valuesByPeriod.get(period.period);
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
  const explanation = 'Cada barra representa un trade individual en orden de cierre y su altura es |PnL| en la unidad seleccionada (USD o R histórica). No se promedia ni se agrupa por meses. Se toma el valor absoluto después de convertir cada trade; su resultado con signo aparece en la ayuda. No representa máximos, mínimos ni recorrido intratrade.';
  $('growth-trade-count').textContent = points.length ? `Trades ${points[0].number}–${points.at(-1).number} de ${count} con los filtros actuales. Una barra por operación, ajustada al ancho disponible.` : 'Sin operaciones para estos filtros.';
  renderChart('growth-absolute-pnl-chart', [{ values: points.map(({ trade, number, absolute }) => [
    `Trade #${number} · ${trade.symbol} · ${trade.closed}`, absolute,
    `PnL original: ${signed(trade.pnl)}. Valor absoluto: ${money(absolute)}. Cierre: ${trade.closed}. Identificador: ${trade.id}.`
  ]), color: '#5c9bff' }], { currency: true, bar: true, labels: points.map(point => `#${point.number}`), title: 'Valor absoluto del PnL de cada trade', explanation });
}

function renderGrowthAverageChart(rows) {
  const selected = $('growth-average-period').value;
  const unit = ['day', 'week', 'month'].includes(selected) ? selected : 'week';
  const periods = growthPeriods(rows, unit);
  renderChart('growth-average-pnl-chart', [{ values: periods.map(period => [period.period, period.meanAbsolutePnl]), color: '#5c9bff' }], { currency: true, bar: true, explanation: 'Suma de |PnL| de cada trade cerrado del período ÷ número de trades del período. Agrupa por fecha de cierre en Nueva York; las semanas van de lunes a domingo y se etiquetan por su lunes. Se omiten períodos sin operaciones y se respetan los filtros generales. Se toma el valor absoluto antes de promediar, incluyendo las operaciones a cero: +$10 y −$6 dan $8.' });
}

function renderGrowth(rows) {
  const pnls = rows.map(trade => trade.pnl).filter(Number.isFinite);
  const absolutePnls = pnls.map(Math.abs);
  $('growth-stats').innerHTML = [
    ['Beneficio acumulado', rows.length ? signed(sum(rows)) : '—', 'Suma del PnL de las operaciones cerradas filtradas, partiendo de cero. Las comisiones del CSV no se descuentan de nuevo; no es saldo de cuenta ni rentabilidad porcentual.'],
    ['PnL medio por trade', pnls.length ? signed(mean(pnls)) : '—', 'Suma del PnL de los trades ÷ número de trades. Se mantiene el signo y se incluyen los trades a cero. Cada operación pesa igual. Se expresa en la unidad seleccionada y no se divide por precio ni por shares.'],
    ['PnL absoluto medio por trade', absolutePnls.length ? money(mean(absolutePnls)) : '—', 'Media de |PnL|, tomando primero el valor absoluto de cada trade. Ejemplo: +$10 y −$6 dan ($10 + $6) ÷ 2 = $8. Ganancias y pérdidas no se cancelan. Una magnitud mayor también puede proceder de pérdidas mayores.'],
    ['PnL absoluto mediano por trade', absolutePnls.length ? money(sampleQuantile(absolutePnls, 0.5)) : '—', 'Mediana de los valores |PnL| de cada trade, en la unidad seleccionada. Reduce la influencia de operaciones excepcionalmente grandes. No utiliza precio de la acción ni cantidad de shares.']
  ].map(args => consistencyMetric(...args)).join('');
  renderSessionRisk();
  renderGrowthTradeChart(rows);
  renderGrowthAverageChart(rows);
  renderSessionSwings(rows);
}

function incorporationCountry(profile) {
  const value = typeof profile?.incorporation_country === 'string' ? profile.incorporation_country.trim() : '';
  return ['unknown', 'unverified', 'n/a', 'n/d', 'sin confirmar', 'sin clasificar', '—', '-'].includes(value.toLowerCase()) ? '' : value;
}

function tradeCountry(trade) {
  return incorporationCountry(dataset?.tickerProfiles?.[trade.symbol]);
}

function renderCountries(rows) {
  renderCountryStudies(rows);
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
  renderNewsCoverage();
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
  $('data-news-refresh').disabled = true;
  $('data-news-status').textContent = 'Cargando los últimos datos publicados y comprobando la cobertura de noticias…';
  $('data-audit-status').textContent = 'Cargando los últimos datos publicados y comprobando los tickers…';
  try {
    if (await loadData({ preserveFilters: true })) {
      location.hash = '#data';
      activateView();
    } else {
      $('data-audit-status').textContent = 'No se ha podido actualizar la comprobación. La lista anterior se conserva; revisa el error de carga e inténtalo de nuevo.';
      $('data-news-status').textContent = 'No se ha podido actualizar la comprobación de noticias. Revisa el error de carga e inténtalo de nuevo.';
    }
  } finally {
    $('data-check-pending').disabled = !dataset;
    $('data-news-refresh').disabled = !dataset;
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
  const weeks = calendarWeekSummaries(month, rows);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  let weekIndex = 0;
  $('calendar-summary').textContent = `${monthRows.length} operaciones · ${daily.size} sesiones · PnL ${signed(sum(monthRows))}`;
  let html = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(day => `<div class="calendar-weekday">${day}</div>`).join('');
  html += '<div class="calendar-weekday calendar-weekly-heading">Semana</div>';
  html += '<div class="calendar-blank" aria-hidden="true"></div>'.repeat(offset);
  for (let day = 1; day <= count; day++) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    const trades = monthRows.filter(t => t.date === date);
    const pnl = daily.get(date);
    const holiday = calendarHoliday(date);
    const holidayLabel = holiday ? `Festivo bursátil: ${holiday}. Mercado cerrado.` : '';
    const holidayMarkup = holiday ? `<small class="calendar-holiday-label">Festivo · ${esc(holiday)}</small>${trades.length ? '' : '<small class="calendar-market-closed">Mercado cerrado</small>'}` : '';
    html += `<button type="button" class="calendar-day ${trades.length ? cssSign(pnl) : 'inactive'}${holiday ? ' holiday' : ''}" data-day="${date}" ${helpAttributes(`${date}: ${holidayLabel} ${trades.length} operaciones. Se suma el PnL de las operaciones cerradas este día en Nueva York. ${trades.length ? 'Selecciona el día para consultar sus operaciones.' : ''} ${HELP_PNL}`)} aria-pressed="${selectedCalendarDay === date}" ${trades.length ? '' : 'disabled'} ${holiday ? `title="${esc(holidayLabel)}"` : ''} aria-label="${date}, ${holiday ? `${esc(holidayLabel)} ` : ''}${trades.length} operaciones${trades.length ? `, ${esc(signed(pnl))}` : ''}"><span>${day}</span>${trades.length ? `<strong>${esc(signed(pnl))}</strong><small>${trades.length} trades</small>` : holiday ? '' : '<small>—</small>'}${holidayMarkup}</button>`;
    if ((offset + day) % 7 === 0) html += calendarWeekMarkup(weeks[weekIndex++], today);
  }
  const trailing = (7 - (offset + count) % 7) % 7;
  if (trailing) html += '<div class="calendar-blank" aria-hidden="true"></div>'.repeat(trailing) + calendarWeekMarkup(weeks[weekIndex], today);
  $('calendar-grid').innerHTML = html;
  renderCalendarOverview(rows, month);
  const selected = rows.filter(t => t.date === selectedCalendarDay && t.date.startsWith(month));
  $('calendar-selection').textContent = selected.length ? `${selectedCalendarDay} · ${selected.length} operaciones · ${signed(sum(selected))}` : 'Selecciona un día operado para ver sus operaciones.';
  $('calendar-trades').innerHTML = selected.length ? tableMarkup(['Símbolo', 'Dirección', 'Apertura NY', 'Cierre NY', 'PnL'], selected.map(t => [t.symbol, t.side === 'BUY' ? 'Long' : 'Short', t.opened.slice(11, 19), t.closed.slice(11, 19), signed(t.pnl)])) : '';
  renderCalendarDay(selected);
}

function comparisonRows(key) {
  return displayPnlRows(tradeFilterPanels.get(key).matchingRows());
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
  initializeWatchlist();
  initializeOptimal();
  initializeGrowthProjection();
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
  $('data-news-refresh').addEventListener('click', checkPendingIssuers);
  $('data-news-search').addEventListener('input', renderNewsCoverage);
  $('data-news-kind').addEventListener('change', renderNewsCoverage);
  $('data-pending-search').addEventListener('input', renderPendingIssuers);
  $('data-pending-kind').addEventListener('change', renderPendingIssuers);
  $('growth-trade-window').addEventListener('change', () => renderGrowthTradeChart(filtered));
  $('growth-average-period').addEventListener('change', () => renderGrowthAverageChart(filtered));
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
