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
let journalMonth = '';
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

function journalDateRange() {
  return typeof tradeFilterPanels === 'undefined' ? {} : tradeFilterPanels.get('general')?.appliedCriteria || {};
}

function journalFilteredRows() {
  const { from, to } = journalDateRange();
  if (from && to && from > to) return [];
  return journalData.sessions.filter(row => (!from || row.date >= from) && (!to || row.date <= to));
}

function journalMonths(rows) { return [...new Set(rows.map(row => row.date.slice(0, 7)))].sort(); }

function renderJournalCalendar(rows) {
  const months = journalMonths(rows);
  const title = month => new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`));
  document.getElementById('journal-month').innerHTML = months.map(month => `<option value="${month}">${title(month)}</option>`).join('');
  document.getElementById('journal-month').value = journalMonth;
  const index = months.indexOf(journalMonth);
  document.getElementById('journal-month-prev').disabled = index <= 0;
  document.getElementById('journal-month-next').disabled = index < 0 || index >= months.length - 1;
  const host = document.getElementById('journal-calendar');
  if (!journalMonth || !rows.length) { host.innerHTML = '<p class="journal-empty">No hay días en este intervalo.</p>'; return; }
  const [year, month] = journalMonth.split('-').map(Number);
  const offset = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const entries = new Map(rows.map(row => [row.date, row]));
  const cells = Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, index) => {
    const day = index - offset + 1;
    if (day < 1 || day > days) return '<span class="journal-calendar-spacer" aria-hidden="true"></span>';
    const date = `${journalMonth}-${String(day).padStart(2, '0')}`;
    const row = entries.get(date);
    const label = row ? Number.isFinite(row.overall) ? `Nota ${journalNumber(row.overall)}` : JOURNAL_STATUSES[row.status] : 'Sin registro';
    return `<button type="button" class="journal-calendar-day ${row ? `journal-day-${row.status}` : 'journal-day-empty'}" data-journal-date="${date}" aria-pressed="${date === journalSelectedDate}" aria-controls="journal-session-detail" aria-label="${journalDate(date)} · ${label}" ${row ? '' : 'disabled'}><span>${day}</span><small>${label}</small></button>`;
  });
  host.innerHTML = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(day => `<span class="journal-calendar-weekday" aria-hidden="true">${day}</span>`).join('') + cells.join('');
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
  const months = journalMonths(rows);
  if (!months.includes(journalMonth)) journalMonth = rows.find(row => row.date === journalSelectedDate)?.date.slice(0, 7) || rows.filter(row => row.status === 'evaluated').at(-1)?.date.slice(0, 7) || months.at(-1) || '';
  const monthRows = rows.filter(row => row.date.startsWith(journalMonth));
  if (!monthRows.some(row => row.date === journalSelectedDate)) journalSelectedDate = monthRows.filter(row => row.status === 'evaluated').at(-1)?.date || monthRows.at(-1)?.date || '';
  const evaluated = rows.filter(row => Number.isFinite(row.overall));
  const lastSize = rows.filter(row => Number.isFinite(row.sizeAfter)).at(-1)?.sizeAfter;
  const average = evaluated.length ? evaluated.reduce((sum, row) => sum + row.overall, 0) / evaluated.length : null;
  const highErrors = rows.filter(row => Number.isFinite(row.errorScore) && row.errorScore > journalData.settings.errorLimit).length;
  document.getElementById('journal-summary').innerHTML = [['Sesiones con nota', evaluated.length], ['Nota media', journalNumber(average)], ['Último size del período', journalNumber(lastSize)], ['Errores sobre el límite', highErrors]].map(([label, value]) => `<div class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div></div>`).join('');
  const { from, to } = journalDateRange();
  const invalidRange = from && to && from > to;
  document.getElementById('journal-status').textContent = invalidRange ? 'La fecha inicial debe ser anterior o igual a la fecha final.' : `${rows.length} fechas · ${evaluated.length} con nota · ${rows.filter(row => row.status === 'paused').length} en pausa · ${rows.filter(row => row.status === 'not_evaluated').length} sin evaluar · ${rows.filter(row => row.status === 'incomplete').length} pendientes`;
  document.getElementById('journal-session-table').innerHTML = rows.length ? `<table class="journal-table"><thead><tr><th>Fecha</th><th>Estado</th><th>Nota</th><th>Error</th><th>Size antes</th><th>Size después</th></tr></thead><tbody>${rows.slice().reverse().map(row => `<tr class="${row.date === journalSelectedDate ? 'journal-selected' : ''}"><th><button type="button" data-journal-date="${row.date}" aria-pressed="${row.date === journalSelectedDate}">${journalDate(row.date)}</button></th><td><span class="journal-badge">${JOURNAL_STATUSES[row.status]}</span></td><td>${journalNumber(row.overall)}</td><td class="${row.errorScore > journalData.settings.errorLimit ? 'journal-high-error' : ''}">${journalNumber(row.errorScore)}</td><td>${journalNumber(row.sizeBefore)}</td><td>${journalNumber(row.sizeAfter)}</td></tr>`).join('')}</tbody></table>` : '<p class="journal-empty">No hay sesiones en este intervalo.</p>';
  renderJournalCalendar(rows);
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
  const selectDay = event => {
    const button = event.target.closest('[data-journal-date]');
    if (button && !button.disabled && journalData && journalFilteredRows().some(row => row.date === button.dataset.journalDate)) {
      journalSelectedDate = button.dataset.journalDate;
      journalMonth = journalSelectedDate.slice(0, 7);
      renderJournal();
    }
  };
  document.getElementById('journal-session-table').addEventListener('click', selectDay);
  document.getElementById('journal-calendar').addEventListener('click', selectDay);
  document.getElementById('journal-month').addEventListener('change', event => {
    journalMonth = event.target.value;
    journalSelectedDate = '';
    renderJournal();
  });
  for (const [id, offset] of [['journal-month-prev', -1], ['journal-month-next', 1]]) document.getElementById(id).addEventListener('click', () => {
    if (!journalData) return;
    const months = journalMonths(journalFilteredRows());
    const next = months[months.indexOf(journalMonth) + offset];
    if (next) { journalMonth = next; journalSelectedDate = ''; renderJournal(); }
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
    renderJournal();
  } catch {
    document.getElementById('journal-status').textContent = 'No se ha podido cargar el diario. Recarga la página para volver a intentarlo.';
  }
}
