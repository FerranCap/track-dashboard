'use strict';

const JOURNAL_GROUPS = [
  { id: 'preparation', label: 'Preparación', fields: [['rest', 'Descanso'], ['energy', 'Energía'], ['stress', 'Estrés'], ['wellbeing', 'Bienestar'], ['expectations', 'Expectativas'], ['confidence', 'Seguridad']] },
  { id: 'fundamental', label: 'Fundamental', fields: [['fundamentalAnalysis', 'Análisis'], ['fundamentalTracking', 'Seguimiento']] },
  { id: 'technical', label: 'Técnico', fields: [['volume', 'Volumen'], ['managementLevels', 'Puntos de gestión'], ['riskReward', 'Risk Reward'], ['technicalTracking', 'Seguimiento']] },
  { id: 'execution', label: 'Ejecución', fields: [['exitDiscipline', 'Disciplina de salida'], ['entryDiscipline', 'Disciplina de entrada'], ['sizing', 'Size']] }
];
const JOURNAL_STATUSES = { evaluated: 'Evaluada', not_evaluated: 'Sin evaluar', paused: 'Pausa', incomplete: 'Pendiente' };
const JOURNAL_DEFAULT_CHARTS = ['overall', 'size', 'errors'];
const JOURNAL_COLORS = ['#78adff', '#47d2b4', '#f0ba72'];
let journalData = null;
let journalSelectedDate = '';
let journalView = 'sessions';
let journalSelectedCharts = new Set(JOURNAL_DEFAULT_CHARTS);

function journalEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function journalNumber(value, digits = 2) {
  if (value === '-') return 'Sin evaluar';
  return Number.isFinite(value) ? value.toLocaleString('es-ES', { maximumFractionDigits: digits }) : '—';
}

function journalDate(date) { return date.split('-').reverse().join('/'); }

function journalGroupValue(row, group) {
  const values = group.fields.map(([key]) => row[key]);
  return values.every(Number.isFinite) ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function journalChartDefinitions() {
  const series = (label, value) => ({ label, value });
  return [
    { id: 'overall', group: 'General', title: 'Nota general', score: true, series: [series('Nota general', row => row.overall)] },
    ...JOURNAL_GROUPS.flatMap(group => [
      { id: group.id, group: group.label, title: `${group.label} · tendencia general`, score: true, series: [series(group.label, row => journalGroupValue(row, group))] },
      ...group.fields.map(([key, label]) => ({ id: key, group: group.label, title: `${group.label} · ${label}`, score: true, series: [series(label, row => row[key])] }))
    ]),
    { id: 'size', group: 'Size', title: 'Evolución del size', series: [series('Antes', row => row.sizeBefore), series('Después', row => row.sizeAfter)] },
    { id: 'sizePercent', group: 'Size', title: 'Evolución del size · % desde el inicio', unit: '%', series: [series('Variación', row => Number.isFinite(row.sizeAfter) ? (row.sizeAfter / journalData.settings.baseSize - 1) * 100 : null)] },
    { id: 'sizeAdded', group: 'Size', title: 'Size añadido por sesión', bar: true, series: [series('Añadido', row => row.sizeAdded)] },
    { id: 'sizeAddedPercent', group: 'Size', title: 'Size añadido por sesión · %', bar: true, unit: '%', series: [series('Incremento', row => Number.isFinite(row.sizeAdded) && row.sizeBefore > 0 ? row.sizeAdded / row.sizeBefore * 100 : null)] },
    { id: 'discretionary', group: 'Resultante', title: 'Resultante discrecional', series: [series('Discrecional', row => row.discretionary)] },
    { id: 'systematic', group: 'Resultante', title: 'Resultante sistemático', series: [series('Sistemático', row => row.systematic)] },
    { id: 'results', group: 'Resultante', title: 'Resultante · comparación', series: [series('Discrecional', row => row.discretionary), series('Sistemático', row => row.systematic)] },
    { id: 'errors', group: 'Errores', title: 'Puntuación de errores', score: true, bar: true, series: [series('Error', row => row.errorScore)] },
    { id: 'previousTechnical', group: 'Histórico', title: 'Análisis técnico anterior', score: true, series: [series('Análisis técnico anterior', row => row.previousTechnical)] },
    { id: 'previousFocus', group: 'Histórico', title: 'Focus anterior', score: true, series: [series('Focus anterior', row => row.previousFocus)] }
  ];
}

function journalFilteredRows() {
  const from = document.getElementById('journal-from').value;
  const to = document.getElementById('journal-to').value;
  if (from && to && from > to) return [];
  return journalData.sessions.filter(row => (!from || row.date >= from) && (!to || row.date <= to));
}

function journalChartSvg(definition, rows) {
  const series = definition.series.map((item, index) => ({ ...item, color: JOURNAL_COLORS[index], points: rows.map(row => [row.date, item.value(row)]) }));
  const values = series.flatMap(item => item.points.map(point => point[1]).filter(Number.isFinite));
  if (!values.length) return '<p class="journal-empty">Sin valores para este gráfico en las fechas seleccionadas.</p>';
  const width = 720, height = 250, left = 56, right = 20, top = 20, bottom = 40;
  const low = Math.min(0, ...values), high = Math.max(definition.score ? 10 : 0, ...values, low + 1);
  const first = Date.parse(rows[0].date), last = Date.parse(rows.at(-1).date);
  const x = date => left + (last === first ? 0.5 : (Date.parse(date) - first) / (last - first)) * (width - left - right);
  const y = value => top + (high - value) / (high - low) * (height - top - bottom);
  let markup = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${journalEscape(definition.title)}"><title>${journalEscape(definition.title)}. Pasa sobre un punto para ver fecha y valor.</title>`;
  for (let tick = 0; tick <= 4; tick++) {
    const value = low + (high - low) * tick / 4;
    markup += `<line x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}" stroke="#304058" stroke-dasharray="3 5"/><text x="${left - 8}" y="${y(value) + 4}" text-anchor="end">${journalNumber(value, 1)}${definition.unit || ''}</text>`;
  }
  for (const item of series) {
    let path = '', connected = false;
    item.points.forEach(([date, value]) => {
      if (!Number.isFinite(value)) { connected = false; return; }
      const tooltip = journalEscape(`${journalDate(date)} · ${item.label}: ${journalNumber(value)}${definition.unit || ''}`);
      if (definition.bar) {
        const barWidth = Math.min(22, (width - left - right) / Math.max(rows.length, 1) * 0.5);
        markup += `<rect x="${x(date) - barWidth / 2}" y="${Math.min(y(0), y(value))}" width="${barWidth}" height="${Math.max(2, Math.abs(y(value) - y(0)))}" fill="${item.color}"><title>${tooltip}</title></rect>`;
      } else {
        path += `${connected ? 'L' : 'M'}${x(date)},${y(value)} `;
        markup += `<circle cx="${x(date)}" cy="${y(value)}" r="3.5" fill="${item.color}"><title>${tooltip}</title></circle>`;
        connected = true;
      }
    });
    if (path) markup += `<path d="${path}" fill="none" stroke="${item.color}" stroke-width="1.8" pointer-events="none"/>`;
  }
  const ticks = [...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])];
  for (const index of ticks) markup += `<text x="${x(rows[index].date)}" y="${height - 12}" text-anchor="middle">${journalDate(rows[index].date)}</text>`;
  return `${markup}</svg><div class="journal-legend">${series.map(item => `<span style="color:${item.color}">${journalEscape(item.label)}</span>`).join('')}</div>`;
}

function renderJournalDetail(rows) {
  const host = document.getElementById('journal-session-detail');
  const row = rows.find(item => item.date === journalSelectedDate);
  if (!row) { host.innerHTML = '<h2>Ficha de la sesión</h2><p class="journal-empty">No hay sesiones en este intervalo.</p>'; return; }
  const field = (label, value) => `<div><dt>${journalEscape(label)}</dt><dd>${journalNumber(value)}</dd></div>`;
  host.innerHTML = `<div class="panel-head"><h2>${journalDate(row.date)}</h2><span class="journal-badge">${JOURNAL_STATUSES[row.status]}</span></div>
    <div class="journal-detail-block"><h3>Comentario y errores</h3><p class="journal-comment">${journalEscape(row.comment || (typeof row.rest === 'string' && row.rest !== '-' ? row.rest : row.status === 'paused' ? 'Semana de reenfoque. Sin sesión evaluada.' : 'Sin comentario registrado.'))}</p><dl class="journal-values">${field('Puntuación del error', row.errorScore)}${field('Nota general', row.overall)}</dl></div>
    ${JOURNAL_GROUPS.map(group => `<div class="journal-detail-block"><h3>${group.label}</h3><dl class="journal-values">${group.fields.map(([key, label]) => field(label, row[key])).join('')}</dl></div>`).join('')}
    <div class="journal-detail-block"><h3>Resultante</h3><dl class="journal-values">${field('Discrecional', row.discretionary)}${field('Sistemático', row.systematic)}</dl></div>
    <div class="journal-detail-block"><h3>Size</h3><dl class="journal-values">${field('Antes', row.sizeBefore)}${field('Después', row.sizeAfter)}${field('Añadido', row.sizeAdded)}</dl></div>
    ${Number.isFinite(row.previousTechnical) || Number.isFinite(row.previousFocus) ? `<div class="journal-detail-block"><h3>Histórico</h3><dl class="journal-values">${field('Análisis técnico anterior', row.previousTechnical)}${field('Focus anterior', row.previousFocus)}</dl></div>` : ''}`;
}

function renderJournal() {
  if (!journalData) return;
  const rows = journalFilteredRows();
  if (!rows.some(row => row.date === journalSelectedDate)) journalSelectedDate = rows.filter(row => row.status === 'evaluated').at(-1)?.date || rows.at(-1)?.date || '';
  const evaluated = rows.filter(row => Number.isFinite(row.overall));
  const lastSize = rows.filter(row => Number.isFinite(row.sizeAfter)).at(-1)?.sizeAfter;
  const average = evaluated.length ? evaluated.reduce((sum, row) => sum + row.overall, 0) / evaluated.length : null;
  const highErrors = rows.filter(row => Number.isFinite(row.errorScore) && row.errorScore > journalData.settings.errorLimit).length;
  document.getElementById('journal-summary').innerHTML = [['Sesiones con nota', evaluated.length], ['Nota media', journalNumber(average)], ['Último size del período', journalNumber(lastSize)], ['Errores sobre el límite', highErrors]].map(([label, value]) => `<div class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div></div>`).join('');
  const invalidRange = document.getElementById('journal-from').value && document.getElementById('journal-to').value && document.getElementById('journal-from').value > document.getElementById('journal-to').value;
  document.getElementById('journal-status').textContent = invalidRange ? 'La fecha inicial debe ser anterior o igual a la fecha final.' : `${rows.length} fechas · ${evaluated.length} con nota · ${rows.filter(row => row.status === 'paused').length} en pausa · ${rows.filter(row => row.status === 'not_evaluated').length} sin evaluar · ${rows.filter(row => row.status === 'incomplete').length} pendientes`;
  document.getElementById('journal-session-table').innerHTML = rows.length ? `<table class="journal-table"><thead><tr><th>Fecha</th><th>Estado</th><th>Nota</th><th>Error</th><th>Size antes</th><th>Size después</th></tr></thead><tbody>${rows.slice().reverse().map(row => `<tr class="${row.date === journalSelectedDate ? 'journal-selected' : ''}"><th><button type="button" data-journal-date="${row.date}" aria-pressed="${row.date === journalSelectedDate}">${journalDate(row.date)}</button></th><td><span class="journal-badge">${JOURNAL_STATUSES[row.status]}</span></td><td>${journalNumber(row.overall)}</td><td class="${row.errorScore > journalData.settings.errorLimit ? 'journal-high-error' : ''}">${journalNumber(row.errorScore)}</td><td>${journalNumber(row.sizeBefore)}</td><td>${journalNumber(row.sizeAfter)}</td></tr>`).join('')}</tbody></table>` : '<p class="journal-empty">No hay sesiones en este intervalo.</p>';
  renderJournalDetail(rows);
  renderJournalCharts(rows);
}

function renderJournalCharts(rows = journalFilteredRows()) {
  const definitions = journalChartDefinitions().filter(chart => journalSelectedCharts.has(chart.id));
  const host = document.getElementById('journal-chart-grid');
  document.getElementById('journal-chart-count').textContent = `(${definitions.length})`;
  if (journalView !== 'charts') return;
  host.innerHTML = definitions.length ? definitions.map(chart => `<section class="panel journal-chart-card"><h2>${chart.title}</h2>${journalChartSvg(chart, rows)}</section>`).join('') : '<div class="panel journal-empty">Selecciona los gráficos que quieras ver en «Mostrar gráficos».</div>';
}

function setJournalView(view) {
  journalView = view;
  for (const key of ['sessions', 'charts']) {
    const active = key === view;
    const tab = document.getElementById(`journal-tab-${key}`);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(`journal-${key}`).hidden = !active;
  }
  document.getElementById('journal-chart-menu').hidden = view !== 'charts';
  if (journalData) renderJournalCharts();
}

function saveJournalCharts() {
  try { localStorage.setItem('track-journal-charts-v1', JSON.stringify([...journalSelectedCharts])); } catch {}
  document.querySelectorAll('[data-journal-chart]').forEach(input => { input.checked = journalSelectedCharts.has(input.dataset.journalChart); });
  if (journalData) renderJournalCharts();
}

async function initializeJournal() {
  const definitions = journalChartDefinitions();
  try {
    const stored = JSON.parse(localStorage.getItem('track-journal-charts-v1'));
    if (Array.isArray(stored)) journalSelectedCharts = new Set(stored.filter(id => definitions.some(chart => chart.id === id)));
  } catch {}
  document.getElementById('journal-chart-choices').innerHTML = [...new Set(definitions.map(chart => chart.group))].map(group => `<fieldset><legend>${group}</legend>${definitions.filter(chart => chart.group === group).map(chart => `<label><input type="checkbox" data-journal-chart="${chart.id}" ${journalSelectedCharts.has(chart.id) ? 'checked' : ''}>${chart.title}</label>`).join('')}</fieldset>`).join('');
  document.getElementById('journal-chart-choices').addEventListener('change', event => {
    const id = event.target.dataset.journalChart;
    if (!id) return;
    if (event.target.checked) journalSelectedCharts.add(id); else journalSelectedCharts.delete(id);
    saveJournalCharts();
  });
  document.querySelectorAll('[data-journal-preset]').forEach(button => button.addEventListener('click', () => {
    journalSelectedCharts = new Set(button.dataset.journalPreset === 'all' ? definitions.map(chart => chart.id) : button.dataset.journalPreset === 'none' ? [] : JOURNAL_DEFAULT_CHARTS);
    saveJournalCharts();
  }));
  for (const view of ['sessions', 'charts']) {
    const tab = document.getElementById(`journal-tab-${view}`);
    tab.addEventListener('click', () => setJournalView(view));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const target = event.key === 'Home' ? 'sessions' : event.key === 'End' ? 'charts' : view === 'charts' ? 'sessions' : 'charts';
      setJournalView(target);
      document.getElementById(`journal-tab-${target}`).focus();
    });
  }
  for (const id of ['journal-from', 'journal-to']) document.getElementById(id).addEventListener('change', renderJournal);
  document.getElementById('journal-reset-dates').addEventListener('click', () => {
    document.getElementById('journal-from').value = '';
    document.getElementById('journal-to').value = '';
    renderJournal();
  });
  document.getElementById('journal-session-table').addEventListener('click', event => {
    const button = event.target.closest('[data-journal-date]');
    if (button) { journalSelectedDate = button.dataset.journalDate; renderJournal(); }
  });
  try {
    const response = await fetch(`data/journal.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.schemaVersion !== 1 || !Array.isArray(data.sessions) || !data.sessions.length || !(data.settings?.baseSize > 0)) throw new Error('Invalid journal data');
    const dates = new Set();
    for (const row of data.sessions) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || dates.has(row.date) || !Object.hasOwn(JOURNAL_STATUSES, row.status)) throw new Error('Invalid journal session');
      dates.add(row.date);
    }
    journalData = { ...data, sessions: data.sessions.slice().sort((a, b) => a.date.localeCompare(b.date)) };
    document.getElementById('journal-source').innerHTML = `Copia importada el ${journalDate(data.source.importedOn)} de <a href="${journalEscape(data.source.url)}" target="_blank" rel="noopener noreferrer">Google Sheets · Size Tracker</a>. La hoja no se sincroniza automáticamente.`;
    document.getElementById('journal-rules').textContent = `Size base: ${journalNumber(data.settings.baseSize)}. Subida máxima por sesión: ${journalNumber(data.settings.maxSessionIncrease * 100)}%. La hoja bloquea la subida si el error supera ${journalNumber(data.settings.errorLimit)}. La subida usa las medias de fundamental, técnico y ejecución con el mismo peso. Los resultados y el size mantienen sus unidades originales; no modifican la R del dashboard.`;
    renderJournal();
  } catch {
    document.getElementById('journal-status').textContent = 'No se ha podido cargar el diario. Recarga la página para volver a intentarlo.';
  }
}
