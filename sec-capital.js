'use strict';

const secCapitalIssuers = new Map();
const secCapitalTrades = new Map();
let secCapitalAvailable = false;

async function fetchSecCapital() {
  try {
    const response = await fetch(`data/sec/trade-capital.json?v=${Date.now()}`, { cache: 'no-store' });
    return response.ok ? await response.json() : null;
  } catch (error) {
    console.warn('SEC capital history unavailable:', error);
    return null;
  }
}

function updateSecCapital(payload, source) {
  secCapitalIssuers.clear();
  secCapitalTrades.clear();
  secCapitalAvailable = payload?.schemaVersion === 1 && payload.issuers && Array.isArray(payload.trades);
  if (!secCapitalAvailable) return;
  for (const [symbol, issuer] of Object.entries(payload.issuers)) {
    const cik = source.tickerProfiles?.[symbol]?.cik;
    if (cik && String(cik).replace(/^0+/, '') === String(issuer.cik).replace(/^0+/, '') && Array.isArray(issuer.observations) && issuer.filings) {
      secCapitalIssuers.set(symbol, issuer);
    }
  }
  const trades = new Map(source.trades.map(trade => [trade.id, trade]));
  for (const context of payload.trades) {
    const trade = trades.get(context.tradeId);
    if (trade && trade.symbol === context.symbol && trade.opened === context.entryAt && secCapitalIssuers.has(trade.symbol)) {
      const estimate = context.marketCapEstimate;
      if (estimate && (estimate.price !== trade.entryPrice || !Number.isFinite(estimate.value) || estimate.value <= 0)) continue;
      secCapitalTrades.set(trade.id, context);
    }
  }
}

function secCapitalDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.split('-').reverse().join('/') : 'Sin confirmar';
}

function secCapitalAmount(value, unit) {
  if (value == null || !Number.isFinite(value)) return 'Sin confirmar';
  const number = new Intl.NumberFormat('es-ES', { maximumFractionDigits: unit === 'USD' && Math.abs(value) < 10 ? 6 : 2 }).format(value);
  return `${number} ${unit === 'USD' ? 'USD' : 'acciones / participaciones'}`;
}

function secCapitalLink(filing) {
  if (!/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\//.test(filing?.url || '')) return '';
  return `<a href="${esc(filing.url)}" target="_blank" rel="noopener noreferrer">${esc(filing.form)} · ${esc(filing.accession)}</a>`;
}

function issuerSecCapitalCell(profile, rows) {
  if (!secCapitalAvailable) return '<td class="muted">SEC no disponible</td>';
  const issuer = secCapitalIssuers.get(profile.symbol);
  if (!issuer) return '<td class="muted">Sin revisar</td>';
  const labels = { sharesOutstanding: issuer.securityType === 'ETF' ? 'Participaciones en circulación' : 'Acciones en circulación',
    floatShares: 'Float estimado · acciones de no afiliados', publicFloatValue: 'Public float declarado · valor en USD',
    marketCap: 'Capitalización', netAssets: 'Patrimonio neto del fondo' };
  const history = [...issuer.observations].sort((a, b) => b.asOf.localeCompare(a.asOf)).map(item => {
    const filing = issuer.filings[item.filingId];
    return `<li><strong>${esc(labels[item.metric] || item.metric)}${item.shareClass ? ` · ${esc(item.shareClass)}` : ''}</strong><span>${esc(secCapitalAmount(item.value, item.unit))} · ${item.basis === 'estimated' ? 'Estimado' : 'Declarado'}</span><small>Dato: ${secCapitalDate(item.asOf)} · Presentado: ${secCapitalDate(filing.filedOn)}</small>${secCapitalLink(filing)}<p>${esc(item.evidence)}</p></li>`;
  }).join('');
  const latest = rows.filter(trade => trade.symbol === profile.symbol).sort((a, b) => b.opened.localeCompare(a.opened))[0];
  const context = latest && secCapitalTrades.get(latest.id);
  const estimate = context?.marketCapEstimate;
  const estimateLabel = estimate?.scope === 'quoted_class'
    ? `Valor estimado de ${esc(estimate.shareClass)} a la entrada (excluye otras clases)`
    : 'Capitalización estimada a la entrada';
  const reference = latest ? `<div class="sec-capital-reference"><strong>Última entrada en los filtros: ${esc(latest.opened.slice(0, 10).split('-').reverse().join('/'))} · ${esc(latest.opened.slice(11, 19))} NY</strong>${estimate
    ? `<p>${estimateLabel}: <strong>${esc(secCapitalAmount(estimate.value, 'USD'))}</strong></p><p>${esc(secCapitalAmount(estimate.shares, 'shares'))} del ${secCapitalDate(estimate.sharesAsOf)} × precio medio de entrada ${esc(secCapitalAmount(estimate.price, 'USD'))}. Antigüedad: ${estimate.shareCountAgeDays} días.</p><p class="warning">Estimación con el último recuento revisado publicado antes de entrar. Los cambios de acciones entre ambas fechas no están completamente conciliados.</p>`
    : `<p>${issuer.securityType === 'ETF' ? 'Capitalización empresarial y float: no asignados a un ETF. Consulta participaciones y patrimonio en el historial; no se han conciliado las creaciones y reembolsos hasta la entrada.' : 'Sin estimación de capitalización disponible para esta entrada.'}</p>`}</div>` : '';
  const events = (issuer.events || []).map(event => `<li><strong>${secCapitalDate(event.asOf)}</strong><p>${esc(event.description)}</p>${secCapitalLink(issuer.filings[event.filingId])}</li>`).join('');
  return `<td class="sec-capital-cell" data-sort-value="${issuer.observations.length}"><details><summary>Ver SEC · ${issuer.observations.length} datos</summary><div class="sec-capital-detail"><strong>${esc(profile.symbol)} · Capital e historial SEC</strong><p class="warning">${issuer.coverage === 'partial' ? 'Revisión parcial' : 'Revisado'} · Consulta ${secCapitalDate(issuer.reviewedOn)}. Importes siempre en USD.</p>${reference}<h4>Historial publicado</h4><p class="muted">Cada dato conserva su fecha y su publicación. El historial puede incluir documentos posteriores a una operación seleccionada.</p><ul class="sec-capital-history">${history}</ul>${events ? `<h4>Eventos y dilución potencial</h4><ul class="sec-capital-history">${events}</ul>` : ''}<h4>Alcance y limitaciones</h4><p>${esc(issuer.scope)}</p><ul>${(issuer.limitations || []).map(note => `<li>${esc(note)}</li>`).join('')}</ul></div></details></td>`;
}
