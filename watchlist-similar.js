'use strict';

const watchlistSimilarityDayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

function watchlistSearchNumber(value) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return null;
  const number = Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function watchlistSearchCountry(value) {
  const country = String(value || '').trim();
  return ['unknown', 'unverified', 'n/a', 'n/d', 'sin definir', 'sin confirmar', 'sin clasificar', '—', '-'].includes(country.toLowerCase()) ? '' : country;
}

function watchlistSearchDefaults(entry) {
  const range = value => {
    const number = watchlistSearchNumber(value);
    return number > 0 ? { enabled: true, min: number * .7, max: number * 1.3, anchor: number }
      : { enabled: false, min: null, max: null, anchor: null };
  };
  return { country: watchlistSearchCountry(entry.country), float: range(entry.float), marketCap: range(entry.marketCap) };
}

function watchlistSearchDay(opened) {
  if (!Number.isFinite(Date.parse(opened))) return null;
  return watchlistSimilarityDayFormat.format(new Date(opened));
}

function watchlistFloatAtEntry(issuer, trade) {
  const day = watchlistSearchDay(trade.opened);
  if (!day) return null;
  return (issuer?.observations || []).filter(item => {
    if (item.metric !== 'floatShares' || !Number.isFinite(item.value) || item.value <= 0 || item.asOf > day || item.shareBasisDate > day) return false;
    if (issuer.quotedShareClass && item.shareClass !== issuer.quotedShareClass) return false;
    const filing = issuer.filings?.[item.filingId];
    if (!filing) return false;
    const available = evidence => evidence?.acceptedAt ? Date.parse(evidence.acceptedAt) < Date.parse(trade.opened) : Boolean(evidence?.filedOn && evidence.filedOn < day);
    if (!available(filing)) return false;
    return !(issuer.events || []).some(event => event.affectsShareBasis && event.asOf > (item.shareBasisDate || item.asOf)
      && event.asOf <= day && available(issuer.filings?.[event.filingId]));
  }).sort((a, b) => b.asOf.localeCompare(a.asOf) || issuer.filings[b.filingId].filedOn.localeCompare(issuer.filings[a.filingId].filedOn))[0] || null;
}

function buildWatchlistSimilarityIndex(source, issuers = new Map(), contexts = new Map()) {
  const records = [];
  const seen = new Set();
  for (const trade of source?.trades || []) {
    if (seen.has(trade.id)) continue;
    seen.add(trade.id);
    const profile = source.tickerProfiles?.[trade.symbol] || {};
    const issuer = issuers.get(trade.symbol);
    const sameIssuer = issuer?.cik && profile.cik && String(issuer.cik).replace(/^0+/, '') === String(profile.cik).replace(/^0+/, '');
    const float = sameIssuer ? watchlistFloatAtEntry(issuer, trade) : null;
    const context = contexts.get(trade.id);
    const estimate = sameIssuer && context?.symbol === trade.symbol && context.entryAt === trade.opened
      && context.marketCapEstimate?.price === trade.entryPrice ? context.marketCapEstimate : null;
    const marketCap = estimate?.scope === 'issuer_common_equity' && Number.isFinite(estimate.value) && estimate.value > 0 ? estimate : null;
    records.push({ trade, profile, country: watchlistSearchCountry(profile.incorporation_country),
      day: watchlistSearchDay(trade.opened), issuer: sameIssuer ? issuer : null, float, marketCap,
      partialMarketCap: estimate?.scope === 'quoted_class' ? estimate : null });
  }
  return records;
}

function findWatchlistSimilar(entry, search, records, profiles = {}) {
  const invalid = ['float', 'marketCap'].filter(key => search[key].enabled &&
    (!Number.isFinite(search[key].min) || !Number.isFinite(search[key].max) || search[key].min < 0 || search[key].max <= 0 || search[key].min > search[key].max));
  const active = ['float', 'marketCap'].filter(key => search[key].enabled);
  const country = watchlistSearchCountry(search.country);
  const result = { search, invalid, active, country, groups: [], missingTrades: 0, missingSymbols: new Set(), outsideTrades: 0, examinedTrades: 0, trades: [] };
  if (invalid.length || (!country && !active.length)) return result;
  const groups = new Map();
  const currentCik = String(profiles[entry.ticker]?.cik || '').replace(/^0+/, '');
  for (const record of records) {
    const { trade, profile } = record;
    if (trade.symbol.toUpperCase() === entry.ticker.toUpperCase()
      || (currentCik && String(profile.cik || '').replace(/^0+/, '') === currentCik)) continue;
    if (country && record.country.toLowerCase() !== country.toLowerCase()) continue;
    result.examinedTrades++;
    const values = { float: record.float?.value / 1e6, marketCap: record.marketCap?.value / 1e6 };
    if (active.some(key => !Number.isFinite(values[key]) || values[key] <= 0)) {
      result.missingTrades++;
      result.missingSymbols.add(trade.symbol);
      continue;
    }
    if (active.some(key => values[key] < search[key].min || values[key] > search[key].max)) {
      result.outsideTrades++;
      continue;
    }
    const distance = active.reduce((total, key) => {
      const middle = (search[key].min + search[key].max) / 2;
      return total + Math.abs(values[key] - middle) / middle;
    }, 0);
    if (!groups.has(trade.symbol)) groups.set(trade.symbol, { symbol: trade.symbol, profile, country: record.country, records: [], distance });
    const group = groups.get(trade.symbol);
    group.records.push(record);
    group.distance = Math.min(group.distance, distance);
    result.trades.push(trade);
  }
  result.groups = [...groups.values()].sort((a, b) => a.distance - b.distance || b.records.length - a.records.length || a.symbol.localeCompare(b.symbol));
  return result;
}

function watchlistRangeLabel(range) {
  const format = value => Number.isFinite(value) ? new Intl.NumberFormat('es-ES', { maximumFractionDigits: 6 }).format(value) : '…';
  return `${format(range.min)}–${format(range.max)} M`;
}

function watchlistSimilarSummary(result) {
  const criteria = [result.country, ...result.active.map(key => `${key === 'float' ? 'Float' : 'Mk'} ${watchlistRangeLabel(result.search[key])}`)].filter(Boolean);
  return `Tickers similares${criteria.length ? ` · ${criteria.join(' · ')} · ${result.groups.length} tickers` : ' · Define los criterios'}`;
}

function watchlistSimilarStats(trades) {
  const rows = displayPnlRows(trades);
  const stats = rows.length ? statistics(rows) : null;
  const values = [['Trades', String(trades.length)], ['Sesiones', String(new Set(trades.map(trade => `${trade.symbol}:${watchlistSearchDay(trade.opened)}`)).size)],
    ['PnL', stats ? signed(stats.pnl) : '—'], ['Win rate', stats ? pct(stats.wins.length, rows.length) : '—'],
    ['Profit factor', stats ? stats.pf === Infinity ? '∞' : num(stats.pf) : '—'], ['PnL medio', stats ? money(stats.expectancy) : '—']];
  return `<dl class="watchlist-similar-stats">${values.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>${trades.length > rows.length ? `<p class="warning">${trades.length - rows.length} trades sin R histórica excluidos de los resultados.</p>` : ''}`;
}

function watchlistSimilarReference(record) {
  const { trade, issuer, float, marketCap, partialMarketCap } = record;
  const source = item => {
    const filing = issuer?.filings?.[item?.filingId];
    return filing ? `${secCapitalDate(item.asOf)} · presentado ${secCapitalDate(filing.filedOn)} · ${secCapitalLink(filing)}` : 'Sin fuente comparable';
  };
  const estimate = marketCap || partialMarketCap;
  const shareObservation = issuer?.observations.find(item => item.id === estimate?.sharesObservationId);
  return `<li><strong>${esc(record.day?.split('-').reverse().join('/') || trade.date)} · ${esc(trade.opened.slice(11, 19))} NY · ${trade.side === 'BUY' ? 'Long' : 'Short'}</strong><p>Float: ${float ? `${esc(secCapitalAmount(float.value, 'shares'))} · ${float.basis === 'estimated' ? 'Estimado' : 'Declarado'}<br>${source(float)}` : 'Sin dato comparable disponible antes de entrar'}.</p><p>${partialMarketCap ? 'Valor estimado de la clase cotizada (excluye otras clases; no se usa como Mk total)' : 'Capitalización estimada a la entrada'}: ${estimate ? `${esc(secCapitalAmount(estimate.value, 'USD'))}<br>Acciones: ${source(shareObservation)} · antigüedad ${estimate.shareCountAgeDays} días` : 'Sin dato comparable'}.</p></li>`;
}

function watchlistSimilarNews(group) {
  if (!issuerNewsAvailable) return '<p class="muted">Noticias no disponibles.</p>';
  const record = issuerNewsIndex.get(group.symbol);
  if (!record) return '<p class="muted">Noticias: sin revisar.</p>';
  const selected = new Map(group.records.map(item => [item.trade.id, item.trade]));
  const reviewed = [...selected.values()].filter(trade => record.reviewedEntries.get(trade.id) === trade.opened).length;
  const articles = [...record.articles.values()].filter(article => [...article.linkedTrades.values()]
    .some(trade => selected.get(trade.id)?.opened === trade.opened));
  if (!reviewed && !articles.length) return '<p class="muted">Noticias: sin revisar para estas entradas.</p>';
  const items = articles.map(article => {
    const warnings = [...(article.sourceWarnings || [])];
    if (article.timePrecision === 'day' && [...selected.values()].some(trade => article.linkedTrades.has(trade.id) && newsCalendarDay(trade.opened) === article.publicationDate)) {
      warnings.push('Coincidencia del mismo día por fecha: publicación anterior a la entrada sin confirmar.');
    }
    return `<li>${newsSourceLink(article.url, article.headline)}<p>${esc(newsPublicationLabel(article))} · ${esc(article.publisher)}</p><p>${esc(article.summary || '')}</p>${warnings.map(note => `<p class="warning">${esc(note)}</p>`).join('')}</li>`;
  }).join('');
  return `<details><summary>Noticias de estas entradas · ${articles.length} publicaciones</summary><p>${reviewed} de ${selected.size} trades revisados. Cobertura parcial; ${articles.length ? 'publicaciones encontradas.' : 'sin publicaciones encontradas en las fuentes consultadas.'}</p><ul class="watchlist-similar-references">${items}</ul></details>`;
}

function watchlistSimilarMarkup(result, limit = 20) {
  if (result.invalid.length) return '<p role="status">Define mínimos y máximos válidos: desde cero, máximo positivo y mínimo menor o igual al máximo.</p>';
  if (!result.country && !result.active.length) return '<p role="status">Elige país o activa un rango de float o capitalización para buscar en tu historial.</p>';
  const missing = result.missingTrades ? `<p class="warning">${result.missingSymbols.size} tickers con ${result.missingTrades} trades ${result.country ? 'de este país' : 'del historial'} descartados por falta de datos numéricos comparables. Puedes desactivar un rango para ampliar la búsqueda.</p>` : '';
  const cards = result.groups.slice(0, limit).map(group => {
    const trades = group.records.map(record => record.trade);
    const security = { direct_equity: 'Acciones directas', ADS: 'ADS / ADR', ETF: 'ETF' }[group.profile.security_type] || 'Tipo de valor sin confirmar';
    return `<article class="watchlist-similar-card"><h4>${esc(group.symbol)} · ${esc(group.profile.issuer_name || 'Emisor sin ficha')}</h4><p>${esc(group.country || 'País sin confirmar')} · ${esc(security)}</p>${watchlistSimilarStats(trades)}<details><summary>Ficha del emisor</summary><p>Jurisdicción: ${esc(group.profile.incorporation_jurisdiction || 'Sin confirmar')} · Operaciones: ${esc(group.profile.operating_country || 'Sin confirmar')} · Sede: ${esc(group.profile.headquarters_country || 'Sin confirmar')}</p><p>CIK ${esc(group.profile.cik || 'Sin confirmar')} · Consulta ${secCapitalDate(group.profile.checked_on)}</p><p>${group.profile.source_profile_url ? newsSourceLink(group.profile.source_profile_url, 'Ficha SEC') : ''} ${group.profile.source_filing_url ? newsSourceLink(group.profile.source_filing_url, 'Documento del emisor') : ''}</p></details><details><summary>Ver referencias y sesiones · ${new Set(group.records.map(record => record.day)).size}</summary><p>Resultados de los trades que cumplen estos criterios. País de constitución según la ficha revisada.</p><ul class="watchlist-similar-references">${group.records.slice().sort((a, b) => b.trade.opened.localeCompare(a.trade.opened)).map(watchlistSimilarReference).join('')}</ul></details>${watchlistSimilarNews(group)}</article>`;
  }).join('');
  return `<p role="status">${result.groups.length} tickers · ${result.trades.length} trades coincidentes · historial completo, independiente de los filtros generales.</p>${missing}${result.trades.length ? watchlistSimilarStats(result.trades) : '<p>No hay coincidencias con estos criterios.</p>'}<p class="muted">Los rangos usan float en millones de acciones y Mk en millones de USD, independientemente del modo USD/R. Los floats SEC pueden ser estimaciones antiguas; no equivalen al float exacto del día. Las capitalizaciones usan recuentos históricos revisados y precio medio de entrada. Los demás campos de la Watchlist no intervienen todavía. Estos resultados describen tu operativa; no predicen el movimiento del precio.</p><div class="watchlist-similar-cards">${cards}</div>${result.groups.length > limit ? `<button type="button" data-similar-more>Mostrar siguientes ${Math.min(20, result.groups.length - limit)} · ${limit} de ${result.groups.length}</button>` : ''}`;
}

function createWatchlistSimilarPanel(entry, options) {
  const row = document.createElement('tr');
  row.className = 'watchlist-similar-row';
  const cell = document.createElement('td');
  cell.colSpan = options.columnCount;
  const disclosure = document.createElement('details');
  disclosure.className = 'watchlist-similar';
  const summary = document.createElement('summary');
  const panel = document.createElement('div');
  panel.className = 'watchlist-similar-panel';
  const controls = document.createElement('div');
  controls.className = 'watchlist-similar-controls';
  const countryLabel = document.createElement('label');
  countryLabel.textContent = 'País de constitución';
  const country = document.createElement('select');
  country.setAttribute('aria-label', `${entry.ticker}: país de búsqueda`);
  countryLabel.append(country);
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'secondary';
  reset.textContent = 'Usar valores de la entrada';
  reset.title = 'Restablece país y rangos de −30 % a +30 % de la entrada';
  const note = document.createElement('p');
  note.className = 'watchlist-similar-note';
  const results = document.createElement('div');
  results.className = 'watchlist-similar-results';
  let search = watchlistSearchDefaults(entry);
  let dirty = false;
  let limit = 20;
  const signature = () => JSON.stringify([entry.country, entry.float, entry.marketCap]);
  let entrySignature = signature();
  let countriesSignature = '';
  const ranges = {};

  function setNumericInput(input, value) {
    if (document.activeElement === input) return;
    const text = Number.isFinite(value) ? String(Number(value.toFixed(6))) : '';
    if (input.value !== text) input.value = text;
  }

  function syncControls() {
    const choices = [['', 'Todos los países'], ...options.getCountries()];
    if (search.country && !choices.some(([value]) => value === search.country)) choices.push([search.country, search.country]);
    const nextSignature = JSON.stringify(choices);
    if (countriesSignature !== nextSignature) {
      country.replaceChildren();
      for (const [value, label] of choices) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        country.append(option);
      }
      countriesSignature = nextSignature;
    }
    country.value = search.country;
    for (const key of ['float', 'marketCap']) {
      const state = search[key], ui = ranges[key];
      ui.enabled.checked = state.enabled;
      setNumericInput(ui.minimum, state.min);
      setNumericInput(ui.maximum, state.max);
      ui.minimum.disabled = ui.maximum.disabled = !state.enabled;
      const valid = Number.isFinite(state.min) && Number.isFinite(state.max) && state.min >= 0 && state.max > 0 && state.min <= state.max;
      if (!ui.bound || state.max > ui.bound) ui.bound = Math.max((state.anchor || 0) * 3, (state.max || 0) * 1.25, 1);
      const bound = ui.bound;
      for (const slider of [ui.lower, ui.upper]) {
        slider.disabled = !state.enabled || !valid;
        slider.max = String(bound);
      }
      ui.lower.value = String(state.min ?? 0);
      ui.upper.value = String(state.max ?? 0);
      ui.lower.setAttribute('aria-valuemax', String(state.max ?? bound));
      ui.upper.setAttribute('aria-valuemin', String(state.min ?? 0));
      ui.selection.style.left = `${valid ? state.min / bound * 100 : 0}%`;
      ui.selection.style.width = `${valid ? (state.max - state.min) / bound * 100 : 0}%`;
      ui.caption.textContent = state.enabled ? `Rango: ${watchlistRangeLabel(state)}` : 'Sin filtro';
    }
    note.textContent = dirty
      ? signature() !== entrySignature ? 'La entrada ha cambiado. Se mantiene tu búsqueda; usa el botón para recuperar sus valores.' : 'Búsqueda personalizada. Los cambios no modifican la entrada.'
      : 'Valores de la entrada · rangos iniciales −30 % / +30 %. Puedes cambiar cada extremo de forma independiente.';
  }

  function refresh() {
    if (!dirty && signature() !== entrySignature) {
      search = watchlistSearchDefaults(entry);
      for (const ui of Object.values(ranges)) ui.bound = null;
      entrySignature = signature();
      limit = 20;
    }
    syncControls();
    const source = options.getSource();
    const result = findWatchlistSimilar(entry, search, options.getRecords(), source?.tickerProfiles || {});
    summary.textContent = watchlistSimilarSummary(result);
    if (disclosure.open) {
      const html = source ? watchlistSimilarMarkup(result, limit) : '<p role="status">El historial aún no está disponible. Usa Actualizar para cargarlo.</p>';
      if (results.innerHTML !== html) results.innerHTML = html;
    }
    options.onLayout();
  }

  function changed() {
    dirty = true;
    limit = 20;
    refresh();
  }

  for (const [key, label] of [['float', 'Float (M)'], ['marketCap', 'Capitalización (M USD)']]) {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'watchlist-similar-range';
    const legend = document.createElement('legend');
    const enabledLabel = document.createElement('label');
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.setAttribute('aria-label', `${entry.ticker}: usar ${label} en la búsqueda`);
    enabledLabel.append(enabled, document.createTextNode(` ${label}`));
    legend.append(enabledLabel);
    const endpoints = document.createElement('div');
    endpoints.className = 'watchlist-range-endpoints';
    const minimum = document.createElement('input');
    const maximum = document.createElement('input');
    for (const [input, name] of [[minimum, 'Mínimo'], [maximum, 'Máximo']]) {
      input.type = 'number';
      input.min = '0';
      input.step = 'any';
      input.setAttribute('aria-label', `${entry.ticker}: ${label} ${name.toLowerCase()}`);
      const inputLabel = document.createElement('label');
      inputLabel.textContent = name;
      inputLabel.append(input);
      endpoints.append(inputLabel);
    }
    const track = document.createElement('div');
    track.className = 'watchlist-range-track';
    const selection = document.createElement('span');
    selection.className = 'watchlist-range-selection';
    const lower = document.createElement('input');
    const upper = document.createElement('input');
    for (const [slider, name] of [[lower, 'mínimo'], [upper, 'máximo']]) {
      slider.type = 'range';
      slider.min = '0';
      slider.step = 'any';
      slider.className = 'watchlist-range-thumb';
      slider.setAttribute('aria-label', `${entry.ticker}: deslizador ${name} ${label}`);
    }
    lower.classList.add('watchlist-range-lower');
    track.append(selection, lower, upper);
    const caption = document.createElement('span');
    caption.className = 'watchlist-range-caption';
    fieldset.append(legend, endpoints, track, caption);
    ranges[key] = { enabled, minimum, maximum, lower, upper, selection, caption };
    enabled.addEventListener('change', () => { search[key].enabled = enabled.checked; changed(); });
    minimum.addEventListener('input', () => { search[key].min = watchlistSearchNumber(minimum.value); changed(); });
    maximum.addEventListener('input', () => { search[key].max = watchlistSearchNumber(maximum.value); changed(); });
    lower.addEventListener('input', () => { search[key].min = Math.min(Number(lower.value), search[key].max); changed(); });
    upper.addEventListener('input', () => { search[key].max = Math.max(Number(upper.value), search[key].min); changed(); });
    controls.append(fieldset);
  }
  country.addEventListener('change', () => { search.country = country.value; changed(); });
  reset.addEventListener('click', () => {
    dirty = false;
    search = watchlistSearchDefaults(entry);
    for (const ui of Object.values(ranges)) ui.bound = null;
    entrySignature = signature();
    limit = 20;
    refresh();
  });
  disclosure.addEventListener('toggle', refresh);
  results.addEventListener('click', event => {
    if (event.target.closest('[data-similar-more]')) {
      limit += 20;
      refresh();
    }
  });
  controls.prepend(countryLabel);
  controls.append(reset);
  panel.append(controls, note, results);
  disclosure.append(summary, panel);
  cell.append(disclosure);
  row.append(cell);
  return { row, disclosure, refresh };
}
