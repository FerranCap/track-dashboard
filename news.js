'use strict';

const issuerNewsIndex = new Map();
const tradeNewsAgeIndex = new Map();
let issuerNewsAvailable = false;
const newsDateFormat = new Intl.DateTimeFormat('es-ES', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const newsDayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

function newsCalendarDay(value) {
  const parts = newsDayFormat.formatToParts(new Date(value));
  const part = type => parts.find(item => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function newsDateFallbackMatches(article, opened, fallbackDays) {
  const date = article.publicationDate;
  if (!Number.isInteger(fallbackDays) || fallbackDays <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return false;
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date) return false;
  const days = (Date.parse(`${newsCalendarDay(opened)}T00:00:00Z`) - parsed) / 86400000;
  return days >= 0 && days <= fallbackDays;
}

function newsPublicationLabel(article) {
  if (article.timePrecision === 'day') {
    const date = article.publicationDate.split('-').reverse().join('/');
    return `${date} · Incluida por fecha · Hora no confirmada`;
  }
  return `${newsDateFormat.format(new Date(article.publishedAt))} NY`;
}

async function fetchTradeNews() {
  try {
    const response = await fetch(`data/news/trade-context.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.warn('Trade news unavailable:', error);
    return null;
  }
}

function updateIssuerNews(payload, source) {
  issuerNewsIndex.clear();
  tradeNewsAgeIndex.clear();
  issuerNewsAvailable = false;
  if (payload?.schemaVersion !== 1 || !Number.isFinite(payload.windowHours) || payload.windowHours <= 0 || !Array.isArray(payload.articles) || !Array.isArray(payload.trades) || !Array.isArray(payload.scopedSymbols)) return;
  const trades = new Map(source.trades.map(trade => [trade.id, trade]));
  const articles = new Map(payload.articles.filter(article => article && typeof article.id === 'string').map(article => [article.id, article]));
  for (const symbol of payload.scopedSymbols) issuerNewsIndex.set(symbol, { articles: new Map(), reviewedTrades: new Set(), reviewedEntries: new Map(), totalTrades: 0, pending: new Map(), hours: payload.windowHours, fallbackDays: payload.dateFallbackDays || 0 });
  for (const trade of source.trades) {
    const record = issuerNewsIndex.get(trade.symbol);
    if (record) record.totalTrades++;
  }
  for (const entry of payload.trades) {
    const trade = trades.get(entry?.tradeId), record = issuerNewsIndex.get(trade?.symbol);
    if (!trade || !record || entry.symbol !== trade.symbol || entry.entryAt !== trade.opened) continue;
    if (entry.reviewStatus && entry.reviewStatus !== 'not_reviewed' && entry.reviewedOn) {
      record.reviewedTrades.add(trade.id);
      record.reviewedEntries.set(trade.id, trade.opened);
    }
    const opened = Date.parse(trade.opened), lower = opened - payload.windowHours * 3600000;
    if (!Number.isFinite(opened)) continue;
    for (const link of Array.isArray(entry.articles) ? entry.articles : []) {
      const article = articles.get(link.articleId);
      if (!article) continue;
      const issuer = [{ symbol: article.symbol, issuerCik: article.issuerCik }, ...(Array.isArray(article.additionalIssuers) ? article.additionalIssuers : [])]
        .find(item => item?.symbol === trade.symbol);
      if (!issuer) continue;
      const profileCik = source.tickerProfiles?.[trade.symbol]?.cik;
      if (!profileCik || String(profileCik).replace(/^0+/, '') !== String(issuer.issuerCik).replace(/^0+/, '')) continue;
      if (article.timePrecision === 'day') {
        if (article.publishedAt != null || article.verificationStatus !== 'verified_date' || !newsDateFallbackMatches(article, trade.opened, payload.dateFallbackDays)) continue;
      } else {
        const published = Date.parse(article.publishedAt);
        const end = published + (article.timePrecision === 'minute' ? 60000 : 0);
        if (article.verificationStatus !== 'verified_publication' || !/(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(article.publishedAt) || !['second', 'minute'].includes(article.timePrecision) || !Number.isFinite(published) || published < lower || published >= opened || end > opened) continue;
      }
      if (!record.articles.has(article.id)) record.articles.set(article.id, { ...article, linkedTrades: new Map() });
      record.articles.get(article.id).linkedTrades.set(trade.id, trade);
      const filterAgeHours = article.timePrecision === 'day'
        ? (Date.parse(`${newsCalendarDay(trade.opened)}T00:00:00Z`) - Date.parse(`${article.publicationDate}T00:00:00Z`)) / 3600000
        : (opened - Date.parse(article.publishedAt)) / 3600000;
      const previous = tradeNewsAgeIndex.get(trade.id);
      if (!previous || filterAgeHours < previous.filterAgeHours) tradeNewsAgeIndex.set(trade.id, { opened: trade.opened, symbol: trade.symbol, filterAgeHours });
    }
    const pendingIds = new Set(Array.isArray(entry.unresolvedCandidateIds) ? entry.unresolvedCandidateIds : []);
    for (const review of Array.isArray(payload.reviews) ? payload.reviews : []) {
      if (review.symbol !== trade.symbol) continue;
      for (const candidate of review.unresolvedCandidates || []) {
        if (pendingIds.has(candidate.id)) record.pending.set(candidate.id, candidate);
      }
    }
  }
  issuerNewsAvailable = true;
}

function tradeHasNewsWithin(trade, hours) {
  const news = tradeNewsAgeIndex.get(trade.id);
  return issuerNewsAvailable && Boolean(news) && news.opened === trade.opened && news.symbol === trade.symbol
    && Number.isFinite(hours) && hours > 0 && hours <= 48 && news.filterAgeHours <= hours;
}

function auditNewsCoverage(source) {
  const symbols = new Map();
  for (const trade of source?.trades || []) {
    if (!symbols.has(trade.symbol)) symbols.set(trade.symbol, []);
    symbols.get(trade.symbol).push(trade);
  }
  return [...symbols].map(([symbol, trades]) => {
    const record = issuerNewsIndex.get(symbol);
    const reviewed = issuerNewsAvailable && record?.hours >= 48
      ? trades.filter(trade => record.reviewedEntries.get(trade.id) === trade.opened).length : 0;
    const pending = issuerNewsAvailable && record?.hours >= 48
      ? trades.filter(trade => record.reviewedEntries.get(trade.id) !== trade.opened) : trades;
    const ids = new Set(trades.map(trade => trade.id));
    const candidates = issuerNewsAvailable ? [...(record?.pending.values() || [])].filter(candidate => candidate.candidateTradeIds.some(id => ids.has(id))).length : 0;
    const dates = pending.map(trade => Number.isFinite(Date.parse(trade.opened)) ? newsCalendarDay(trade.opened) : trade.date).filter(Boolean).sort();
    return { symbol, issuer: source.tickerProfiles?.[symbol]?.issuer_name || 'Sin ficha de emisor', total: trades.length, reviewed,
      pending: pending.length, candidates, articles: issuerNewsAvailable && (reviewed || record?.articles.size) ? record?.articles.size || 0 : null,
      firstPending: dates[0] || '', lastPending: dates.at(-1) || '',
      complete: issuerNewsAvailable && reviewed === trades.length && candidates === 0 };
  }).sort((left, right) => right.lastPending.localeCompare(left.lastPending) || left.symbol.localeCompare(right.symbol));
}

function renderNewsCoverage() {
  const audit = auditNewsCoverage(dataset);
  const complete = audit.filter(entry => entry.complete).length;
  const reviewed = audit.reduce((total, entry) => total + entry.reviewed, 0);
  const count = audit.reduce((total, entry) => total + entry.total, 0);
  const candidates = audit.reduce((total, entry) => total + entry.candidates, 0);
  const percentage = audit.length ? complete / audit.length * 100 : 0;
  $('data-news-complete').hidden = !issuerNewsAvailable || !audit.length || complete !== audit.length;
  $('data-news-stats').innerHTML = [
    ['Tickers revisados', issuerNewsAvailable ? `${complete} / ${audit.length}` : '—', 'Tickers con todas sus primeras entradas revisadas para 48 h y sin candidatos pendientes. Se usa todo el historial, sin filtros de análisis.'],
    ['Operaciones revisadas', issuerNewsAvailable ? `${reviewed} / ${count}` : '—', 'Entradas revisadas con el mismo ID y la misma fecha y hora de apertura que en el historial actual. Los trades nuevos o corregidos necesitan revisión propia.'],
    ['Operaciones pendientes', issuerNewsAvailable ? String(count - reviewed) : '—', 'Operaciones que aún no tienen una revisión válida de noticias para su entrada. Sin revisar no significa sin noticias.'],
    ['Candidatos por verificar', issuerNewsAvailable ? String(candidates) : '—', 'Publicaciones localizadas con identidad, fecha o zona horaria todavía sin resolver. No se cuentan como noticias confirmadas.']
  ].map(args => consistencyMetric(...args)).join('');
  $('data-news-progress').value = percentage;
  $('data-news-progress-label').textContent = issuerNewsAvailable
    ? `${num(percentage, 1)} % de tickers revisados · ${complete} de ${audit.length} completos · ${reviewed} de ${count} operaciones revisadas`
    : 'Noticias no disponibles: no se puede comprobar el progreso.';
  $('data-news-status').textContent = issuerNewsAvailable
    ? 'Una revisión puede concluir sin noticias encontradas en las fuentes consultadas. El 100 % indica que todas las entradas están revisadas y no hay candidatos pendientes; no garantiza un archivo de noticias exhaustivo. Los filtros y la búsqueda no cambian este progreso.'
    : 'No se han podido cargar las noticias. Actualiza la comprobación para reintentar; no se considera que los tickers estén revisados.';
  $('data-news-refresh').disabled = !dataset;
  const query = ($('data-news-search').value || '').trim().toLowerCase();
  const kind = $('data-news-kind').value || 'all';
  const pending = audit.filter(entry => !entry.complete);
  const matches = pending.filter(entry => (!query || `${entry.symbol} ${entry.issuer}`.toLowerCase().includes(query))
    && (kind === 'unreviewed' ? entry.reviewed === 0 : kind === 'partial' ? entry.reviewed > 0 && entry.pending > 0 : kind === 'verification' ? entry.candidates > 0 : true));
  $('data-news-pending').hidden = issuerNewsAvailable && pending.length === 0;
  $('data-news-count').textContent = `${matches.length} mostrados · ${pending.length} tickers pendientes en el historial`;
  $('data-news-table').innerHTML = !issuerNewsAvailable ? '<p class="muted">Carga de noticias no disponible; no se puede verificar el estado de las entradas.</p>' : matches.length ? tableMarkup([
    'Ticker', 'Emisor', 'Estado de noticias', 'Operaciones', 'Revisadas', 'Pendientes', 'Candidatos', 'Noticias', 'Primera entrada pendiente', 'Última entrada pendiente'
  ], matches.map(entry => [entry.symbol, entry.issuer, entry.candidates ? entry.pending ? 'Revisión y verificación pendientes' : 'Verificación pendiente' : entry.reviewed ? 'Revisión parcial' : 'Sin revisar',
    entry.total, entry.reviewed, entry.pending, entry.candidates, entry.articles === null ? '—' : entry.articles, entry.firstPending || '—', entry.lastPending || '—'
  ])) : '<p class="muted">No hay tickers pendientes que coincidan con esta búsqueda y tipo de pendiente.</p>';
}

function newsSourceLink(url, label) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return esc(label);
    return `<a href="${esc(parsed.href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
  } catch {
    return esc(label);
  }
}

function newsSourceName(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'Fuente'; }
}

function issuerNewsCell(profile) {
  const record = issuerNewsIndex.get(profile.symbol);
  if (!issuerNewsAvailable) return '<td class="issuer-news" data-sort-value="N/A"><span class="muted">No disponibles</span><small>No se han podido cargar las noticias.</small></td>';
  if (!record || !record.totalTrades) return '<td class="issuer-news" data-sort-value="N/A"><span class="muted">Sin revisar</span></td>';
  const articleDay = article => article.timePrecision === 'day' ? article.publicationDate : newsCalendarDay(article.publishedAt);
  const articles = [...record.articles.values()].sort((a, b) => articleDay(b).localeCompare(articleDay(a)) || (b.publishedAt || '').localeCompare(a.publishedAt || ''));
  const topics = new Set(articles.map(article => article.eventId)).size;
  const pendingTrades = record.totalTrades - record.reviewedTrades.size;
  const count = articles.length;
  if (!count && !record.reviewedTrades.size) return '<td class="issuer-news" data-sort-value="N/A"><span class="muted">Sin revisar</span></td>';
  const kind = { issuer_release: 'Comunicado del emisor', issuer_reporting: 'Información periodística', issuer_filing: 'Documento del emisor' };
  const items = articles.map(article => {
    const sources = [...new Set(article.sourceUrls || [])].map(url => newsSourceLink(url, newsSourceName(url))).join(' · ');
    const entries = [...article.linkedTrades.values()].sort((a, b) => Date.parse(a.opened) - Date.parse(b.opened));
    const warnings = [...(article.sourceWarnings || [])];
    if (article.timePrecision === 'day' && entries.some(trade => newsCalendarDay(trade.opened) === article.publicationDate)) warnings.push('Coincidencia del mismo día por fecha: no se ha confirmado que la publicación fuera anterior a esa entrada.');
    const warningMarkup = warnings.length ? `<div class="news-source-warnings warning"><strong>Limitaciones de la fuente</strong>${warnings.map(warning => `<p>${esc(warning)}</p>`).join('')}</div>` : '';
    return `<li><div class="news-headline">${newsSourceLink(article.url, article.headline)}</div><small><time datetime="${esc(article.publishedAt || article.publicationDate)}">${esc(newsPublicationLabel(article))}</time> · ${esc(article.publisher)} · ${esc(kind[article.kind] || article.kind)}</small><p>${esc(article.summary || '')}</p>${warningMarkup}<div class="news-linked-trades">Vinculada a ${entries.length} ${entries.length === 1 ? 'operación' : 'operaciones'}:<ul>${entries.map(trade => `<li>${esc(newsDateFormat.format(new Date(trade.opened)))} NY · ${trade.side === 'BUY' ? 'Long' : 'Short'}</li>`).join('')}</ul></div>${sources ? `<div class="news-sources">Contrastar: ${sources}</div>` : ''}</li>`;
  }).join('');
  const pending = [...record.pending.values()];
  const pendingMarkup = pending.length ? `<details class="news-pending"><summary>${pending.length} ${pending.length === 1 ? 'publicación pendiente' : 'publicaciones pendientes'} de verificar</summary><ul>${pending.map(candidate => `<li>${newsSourceLink(candidate.url, candidate.reportedDate || 'Fuente pendiente')}<p>${esc(candidate.reason)}</p></li>`).join('')}</ul></details>` : '';
  return `<td class="issuer-news" data-sort-value="${count}"><strong>${count} ${count === 1 ? 'noticia' : 'noticias'}</strong><small>${topics} ${topics === 1 ? 'tema' : 'temas'} · ${record.hours} h previas${record.fallbackDays ? ' (por fecha si falta hora)' : ''}</small><details class="issuer-news-details"><summary>Detalle</summary><div class="news-detail-content"><p class="news-coverage">${record.reviewedTrades.size} de ${record.totalTrades} operaciones revisadas. Cobertura parcial: ${count ? 'publicaciones encontradas, no un historial exhaustivo.' : 'sin noticias encontradas en las fuentes consultadas.'}${pendingTrades ? ` ${pendingTrades} operaciones pendientes de revisar.` : ''}</p>${count ? `<ol class="issuer-news-list">${items}</ol>` : ''}${pendingMarkup}<small>Las noticias se cuentan una vez por ticker y pueden estar vinculadas a varios trades. La hora corresponde a la publicación; no se ha verificado una copia del texto tal como existía antes de la entrada.</small></div></details></td>`;
}
