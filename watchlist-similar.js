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

function watchlistSearchDefaults(entry, settings = {}) {
  const range = (value, key) => {
    const number = watchlistSearchNumber(value);
    return number > 0 ? { enabled: settings[key]?.enabled !== false, min: number * (1 - (settings[key]?.below ?? 30) / 100), max: number * (1 + (settings[key]?.above ?? 30) / 100), anchor: number }
      : { enabled: false, min: null, max: null, anchor: null };
  };
  return { country: settings.country === false ? '' : watchlistSearchCountry(entry.country), float: range(entry.float, 'float'), marketCap: range(entry.marketCap, 'marketCap') };
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
  const disclosure = document.createElement('div');
  disclosure.className = 'watchlist-similar-inline';
  function refresh() {
    const search = watchlistSearchDefaults(entry, options.getSettings());
    const source = options.getSource();
    const result = findWatchlistSimilar(entry, search, options.getRecords(), source?.tickerProfiles || {});
    const rows = displayPnlRows(result.trades);
    const stats = rows.length ? statistics(rows) : null;
    disclosure.hidden = !source || !result.trades.length;
    if (disclosure.hidden) { disclosure.replaceChildren(); return; }
    const values = [
      ['Trades', String(result.trades.length)],
      ['PnL', stats ? signed(stats.pnl) : '\u2014'],
      ['Win rate', stats ? pct(stats.wins.length, rows.length) : '\u2014'],
      ['Profit factor', stats ? stats.pf === Infinity ? '\u221e' : num(stats.pf) : '\u2014'],
      ['PnL medio', stats ? money(stats.expectancy) : '\u2014'],
      ['Mejor trade', rows.length ? signed(Math.max(...stats.values)) : '\u2014'],
      ['Peor trade', rows.length ? signed(Math.min(...stats.values)) : '\u2014']
    ];
    const warnings = [result.missingTrades ? `${result.missingTrades} trades sin datos comparables` : '', result.trades.length > rows.length ? `${result.trades.length - rows.length} trades sin R` : ''].filter(Boolean).join(' \u00b7 ');
    disclosure.innerHTML = `<div class="watchlist-history-label">Trades Similares${warnings ? ` \u00b7 ${esc(warnings)}` : ''}</div><dl class="watchlist-history-stats">${values.map(([name, value]) => `<div><dt>${esc(name)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`;
  }
  return { disclosure, refresh };
}
