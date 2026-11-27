'use strict';

const dataCompletenessFields = [
  ['issuer', 'Nombre del emisor', 'Nombre identificado en la ficha del ticker.'],
  ['cik', 'Identificador SEC · CIK', 'CIK del emisor registrado en la ficha.'],
  ['incorporationCountry', 'País de constitución', 'País de constitución conocido. Es el utilizado en los estudios por país.'],
  ['incorporationJurisdiction', 'Jurisdicción de constitución', 'Estado, territorio o jurisdicción detallada registrada.'],
  ['operatingCountry', 'País de operaciones', 'Existe un país principal de operaciones en la ficha.'],
  ['headquartersCountry', 'País de la sede', 'País de la sede registrado.'],
  ['securityType', 'Tipo de título', 'Acción directa, ADS / ADR, ETF u otro tipo identificado.'],
  ['sharesOutstanding', 'Acciones en circulación', 'Al menos un recuento histórico declarado con fuente SEC, de cualquier clase.'],
  ['floatShares', 'Float · acciones', 'Al menos un float en acciones, declarado o estimado, con fuente SEC.'],
  ['publicFloatValue', 'Public float · valor en USD', 'Valor monetario declarado del capital en manos de no afiliados.'],
  ['marketCap', 'Capitalización total', 'Al menos una capitalización total declarada o estimada. Excluye valores limitados a una clase.'],
  ['quotedClassValue', 'Valor de la clase cotizada', 'Existe una estimación de valor limitada a la clase cotizada, separada de la capitalización total.'],
  ['capitalEvents', 'Eventos de capital y dilución', 'Existe al menos un evento documentado: emisión, split, warrants u otra dilución potencial.'],
  ['news', 'Noticias', 'Al menos una entrada con contexto investigado o una noticia curada vinculada. Una revisión sin noticias encontradas también cuenta como dato.'],
  ['prices1m', 'Histórico de precios · 1 minuto', 'Existe al menos una sesión con velas de un minuto en el proyecto.'],
  ['prices1s', 'Histórico de precios · 1 segundo', 'Existe al menos una sesión con velas de un segundo en el proyecto.']
];
let dataCompleteness = null;

async function fetchDataCompleteness() {
  try {
    const response = await fetch(`data/reference/data-completeness.json?v=${Date.now()}`, { cache: 'no-store' });
    return response.ok ? await response.json() : null;
  } catch (error) {
    console.warn('Data completeness unavailable:', error);
    return null;
  }
}

function updateDataCompleteness(payload, source) {
  dataCompleteness = null;
  const symbols = [...new Set(source.trades.map(trade => trade.symbol))].sort();
  if (payload?.schemaVersion !== 1 || payload.sourceGeneratedAt !== source.generatedAt || payload.tradeCount !== source.tradeCount
    || !Array.isArray(payload.symbols) || JSON.stringify(payload.symbols) !== JSON.stringify(symbols) || !payload.fields) return;
  for (const [key] of dataCompletenessFields) {
    const present = payload.fields[key];
    if (!Array.isArray(present) || new Set(present).size !== present.length || present.some(symbol => !symbols.includes(symbol))) return;
  }
  dataCompleteness = payload;
}

function renderDataCompleteness() {
  const host = $('data-completeness');
  if (!dataCompleteness) {
    host.innerHTML = '<p class="muted" role="status">El inventario de datos no está disponible o no corresponde al historial cargado. Actualiza los datos para comprobar los porcentajes.</p>';
    return;
  }
  const total = dataCompleteness.symbols.length;
  const format = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
  const html = `<p class="mini-caption">${total} tickers operados · historial completo, sin aplicar filtros ni búsqueda. Cuenta la existencia de al menos un dato; no la cobertura histórica completa ni su calidad.</p><div class="data-completeness-grid">${dataCompletenessFields.map(([key, label, description]) => {
    const present = dataCompleteness.fields[key];
    const known = new Set(present);
    const missing = dataCompleteness.symbols.filter(symbol => !known.has(symbol));
    const percentage = total ? format.format(present.length / total * 100) : '0';
    const text = `${present.length} / ${total} · ${percentage} %`;
    return `<details class="data-completeness-item${total && present.length === total ? ' complete' : ''}"><summary><span class="data-completeness-label"><span>${esc(label)}</span><strong>${esc(text)}</strong></span><progress max="${total || 1}" value="${present.length}" aria-label="${esc(`${label}: ${text}`)}">${esc(percentage)} %</progress></summary><div class="data-completeness-detail"><p>${esc(description)}</p><details><summary>Con datos · ${present.length}</summary><p>${present.length ? present.map(esc).join(', ') : 'Ninguno.'}</p></details><details><summary>Sin datos · ${missing.length}</summary><p>${missing.length ? missing.map(esc).join(', ') : 'Ninguno.'}</p></details></div></details>`;
  }).join('')}</div>`;
  if (host.innerHTML !== html) host.innerHTML = html;
}
