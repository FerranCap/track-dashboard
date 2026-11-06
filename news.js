'use strict';

const issuerNewsIndex = new Map();
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
  return days >= 1 && days <= fallbackDays;
}

function newsPublicationLabel(article) {
  if (article.timePrecision === 'day') {
    const date = article.publicationDate.split('-').reverse().join('/');
    return `${date} · Incluida por fecha · ${article.reportedLocalTime ? `${article.reportedLocalTime}, zona horaria sin confirmar` : 'Hora no disponible'}`;
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
  issuerNewsAvailable = false;
  if (payload?.schemaVersion !== 1 || !Number.isFinite(payload.windowHours) || payload.windowHours <= 0 || !Array.isArray(payload.articles) || !Array.isArray(payload.trades) || !Array.isArray(payload.scopedSymbols)) return;
  const trades = new Map(source.trades.map(trade => [trade.id, trade]));
  const articles = new Map(payload.articles.filter(article => article && typeof article.id === 'string').map(article => [article.id, article]));
  for (const symbol of payload.scopedSymbols) issuerNewsIndex.set(symbol, { articles: new Map(), reviewedTrades: new Set(), totalTrades: 0, pending: new Map(), hours: payload.windowHours, fallbackDays: payload.dateFallbackDays || 0 });
  for (const trade of source.trades) {
    const record = issuerNewsIndex.get(trade.symbol);
    if (record) record.totalTrades++;
  }
  for (const entry of payload.trades) {
    const trade = trades.get(entry?.tradeId), record = issuerNewsIndex.get(trade?.symbol);
    if (!trade || !record || entry.symbol !== trade.symbol || entry.entryAt !== trade.opened) continue;
    if (entry.reviewStatus && entry.reviewStatus !== 'not_reviewed' && entry.reviewedOn) record.reviewedTrades.add(trade.id);
    const opened = Date.parse(trade.opened), lower = opened - payload.windowHours * 3600000;
    if (!Number.isFinite(opened)) continue;
    for (const link of Array.isArray(entry.articles) ? entry.articles : []) {
      const article = articles.get(link.articleId);
      if (!article || article.symbol !== trade.symbol) continue;
      const profileCik = source.tickerProfiles?.[trade.symbol]?.cik;
      if (!profileCik || String(profileCik).replace(/^0+/, '') !== String(article.issuerCik).replace(/^0+/, '')) continue;
      if (article.timePrecision === 'day') {
        if (article.publishedAt != null || article.verificationStatus !== 'verified_date' || !newsDateFallbackMatches(article, trade.opened, payload.dateFallbackDays)) continue;
      } else {
        const published = Date.parse(article.publishedAt);
        const end = published + (article.timePrecision === 'minute' ? 60000 : 0);
        if (article.verificationStatus !== 'verified_publication' || !/(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(article.publishedAt) || !['second', 'minute'].includes(article.timePrecision) || !Number.isFinite(published) || published < lower || published >= opened || end > opened) continue;
      }
      if (!record.articles.has(article.id)) record.articles.set(article.id, { ...article, linkedTrades: new Map() });
      record.articles.get(article.id).linkedTrades.set(trade.id, trade);
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
  const kind = { issuer_release: 'Comunicado del emisor', issuer_reporting: 'Información periodística' };
  const items = articles.map(article => {
    const sources = [...new Set(article.sourceUrls || [])].map(url => newsSourceLink(url, newsSourceName(url))).join(' · ');
    const entries = [...article.linkedTrades.values()].sort((a, b) => Date.parse(a.opened) - Date.parse(b.opened));
    return `<li><div class="news-headline">${newsSourceLink(article.url, article.headline)}</div><small><time datetime="${esc(article.publishedAt || article.publicationDate)}">${esc(newsPublicationLabel(article))}</time> · ${esc(article.publisher)} · ${esc(kind[article.kind] || article.kind)}</small><p>${esc(article.summary || '')}</p><div class="news-linked-trades">Antes de ${entries.length} ${entries.length === 1 ? 'operación' : 'operaciones'}:<ul>${entries.map(trade => `<li>${esc(newsDateFormat.format(new Date(trade.opened)))} NY · ${trade.side === 'BUY' ? 'Long' : 'Short'}</li>`).join('')}</ul></div>${sources ? `<div class="news-sources">Contrastar: ${sources}</div>` : ''}</li>`;
  }).join('');
  const pending = [...record.pending.values()];
  const pendingMarkup = pending.length ? `<details class="news-pending"><summary>${pending.length} ${pending.length === 1 ? 'publicación pendiente' : 'publicaciones pendientes'} de verificar</summary><ul>${pending.map(candidate => `<li>${newsSourceLink(candidate.url, candidate.reportedDate || 'Fuente pendiente')}<p>${esc(candidate.reason)}</p></li>`).join('')}</ul></details>` : '';
  return `<td class="issuer-news" data-sort-value="${count}"><strong>${count} ${count === 1 ? 'noticia' : 'noticias'}</strong><small>${topics} ${topics === 1 ? 'tema' : 'temas'} · ${record.hours} h previas${record.fallbackDays ? ' (por fecha si falta hora)' : ''}</small><details class="issuer-news-details"><summary>Detalle</summary><div class="news-detail-content"><p class="news-coverage">${record.reviewedTrades.size} de ${record.totalTrades} operaciones revisadas. Cobertura parcial: ${count ? 'publicaciones encontradas, no un historial exhaustivo.' : 'sin noticias encontradas en las fuentes consultadas.'}${pendingTrades ? ` ${pendingTrades} operaciones pendientes de revisar.` : ''}</p>${count ? `<ol class="issuer-news-list">${items}</ol>` : ''}${pendingMarkup}<small>Las noticias se cuentan una vez por ticker y pueden estar vinculadas a varios trades. La hora corresponde a la publicación; no se ha verificado una copia del texto tal como existía antes de la entrada.</small></div></details></td>`;
}
