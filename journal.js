'use strict';

const JOURNAL_GROUPS = [
  { id: 'preparation', label: 'Preparación', fields: [['rest', 'Descanso'], ['energy', 'Energía'], ['stress', 'Estrés'], ['wellbeing', 'Bienestar'], ['expectations', 'Expectativas'], ['confidence', 'Seguridad']] },
  { id: 'fundamental', label: 'Fundamental', fields: [['fundamentalAnalysis', 'Análisis'], ['fundamentalTracking', 'Seguimiento']] },
  { id: 'technical', label: 'Técnico', fields: [['volume', 'Volumen'], ['managementLevels', 'Puntos de gestión'], ['riskReward', 'Risk Reward'], ['technicalTracking', 'Seguimiento']] },
  { id: 'execution', label: 'Ejecución', fields: [['exitDiscipline', 'Disciplina de salida'], ['entryDiscipline', 'Disciplina de entrada'], ['sizing', 'Size']] }
];
const JOURNAL_STATUSES = { evaluated: 'Evaluada', not_evaluated: '', paused: 'Pausa', incomplete: '' };
const JOURNAL_DEFAULT_CHARTS = journalChartDefinitions().map(chart => chart.id);
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
  if (value === '-') return '—';
  return Number.isFinite(value) ? value.toLocaleString('es-ES', { maximumFractionDigits: digits }) : '—';
}

function journalDate(date) { return date.split('-').reverse().join('/'); }

function journalDisplayUnit() { return typeof pnlDisplayUnit !== 'undefined' && pnlDisplayUnit === 'r' ? 'R' : 'USD'; }

function journalAmount(row, key) {
  const value = row[key];
  if (!Number.isFinite(value) || journalDisplayUnit() === 'USD') return value;
  const risk = typeof sessionRiskAt === 'function' ? sessionRiskAt(row.date)?.risk : null;
  return Number.isFinite(risk) && risk > 0 ? value / risk : null;
}

function journalFormatAmount(row, key) {
  const value = row ? journalAmount(row, key) : null;
  return Number.isFinite(value) ? `${journalNumber(value, journalDisplayUnit() === 'R' ? 6 : 2)} ${journalDisplayUnit()}` : journalNumber(value);
}

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
    { id: 'size', group: 'Size', title: 'Evolución del size', monetary: true, series: [series('Antes', row => journalAmount(row, 'sizeBefore')), series('Después', row => journalAmount(row, 'sizeAfter'))] },
    { id: 'sizePercent', group: 'Size', title: 'Evolución del size · % desde el inicio', unit: '%', series: [series('Variación', row => Number.isFinite(row.sizeAfter) ? (row.sizeAfter / journalData.settings.baseSize - 1) * 100 : null)] },
    { id: 'sizeAdded', group: 'Size', title: 'Size añadido por sesión', monetary: true, bar: true, series: [series('Añadido', row => journalAmount(row, 'sizeAdded'))] },
    { id: 'sizeAddedPercent', group: 'Size', title: 'Size añadido por sesión · %', bar: true, unit: '%', series: [series('Incremento', row => Number.isFinite(row.sizeAdded) && row.sizeBefore > 0 ? row.sizeAdded / row.sizeBefore * 100 : null)] },
    { id: 'discretionary', group: 'Resultante', title: 'Resultante discrecional', monetary: true, series: [series('Discrecional', row => journalAmount(row, 'discretionary'))] },
    { id: 'systematic', group: 'Resultante', title: 'Resultante sistemático', monetary: true, series: [series('Sistemático', row => journalAmount(row, 'systematic'))] },
    { id: 'results', group: 'Resultante', title: 'Resultante · comparación', monetary: true, series: [series('Discrecional', row => journalAmount(row, 'discretionary')), series('Sistemático', row => journalAmount(row, 'systematic'))] },
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

function journalCurrentMonth() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  return `${parts.find(part => part.type === 'year').value}-${parts.find(part => part.type === 'month').value}`;
}

function journalShiftMonth(month, offset) {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1 + offset, 1)).toISOString().slice(0, 7);
}

function renderJournalCalendar(rows) {
  document.getElementById('journal-month').value = journalMonth;
  const host = document.getElementById('journal-calendar');
  const [year, month] = journalMonth.split('-').map(Number);
  const offset = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const entries = new Map(rows.map(row => [row.date, row]));
  const cells = Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, index) => {
    const day = index - offset + 1;
    if (day < 1 || day > days) return '<span class="journal-calendar-spacer" aria-hidden="true"></span>';
    const date = `${journalMonth}-${String(day).padStart(2, '0')}`;
    const row = entries.get(date);
    const label = row && Number.isFinite(row.overall) ? `Nota ${journalNumber(row.overall)}` : row?.status === 'paused' ? 'Pausa' : '-';
    const sizePercent = row && Number.isFinite(row.sizeAdded) && Number.isFinite(row.sizeBefore) && row.sizeBefore > 0 ? row.sizeAdded / row.sizeBefore * 100 : null;
    const sizeLabel = Number.isFinite(sizePercent) ? `${sizePercent > 0 ? '+' : ''}${journalNumber(sizePercent)} %` : '';
    const outcome = row && Number.isFinite(row.overall) ? row.overall >= 5 ? ' journal-day-passed' : ' journal-day-failed' : '';
    const holiday = typeof calendarHoliday === 'function' ? calendarHoliday(date) : '';
    const holidayLabel = holiday ? `Festivo bursátil: ${holiday}. Mercado cerrado.` : '';
    return `<button type="button" class="journal-calendar-day ${row ? `journal-day-${row.status}` : 'journal-day-empty'}${outcome}${holiday ? ' journal-day-holiday' : ''}" data-journal-date="${date}" aria-pressed="${date === journalSelectedDate}" aria-controls="journal-session-detail" aria-label="${journalDate(date)} · ${label}${sizeLabel ? ` · Size añadido ${sizeLabel}` : ''}${holiday ? ` · ${journalEscape(holidayLabel)}` : ''}" ${holiday ? `title="${journalEscape(holidayLabel)}"` : ''} ${row ? '' : 'disabled'}><span>${day}</span><small>${label}</small>${sizeLabel ? `<small class="journal-day-size">${sizeLabel}</small>` : ''}${holiday ? `<small class="journal-holiday-label">${journalEscape(holiday)}</small>` : ''}</button>`;
  });
  host.innerHTML = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(day => `<span class="journal-calendar-weekday" aria-hidden="true">${day}</span>`).join('') + cells.join('');
}

function journalChartSvg(definition, rows) {
  const unit = definition.monetary ? ` ${journalDisplayUnit()}` : definition.unit || '';
  const digits = definition.monetary && journalDisplayUnit() === 'R' ? 6 : 2;
  const series = definition.series.map((item, index) => ({ ...item, color: JOURNAL_COLORS[index], points: rows.map(row => [row.date, item.value(row)]) }));
  const values = series.flatMap(item => item.points.map(point => point[1]).filter(Number.isFinite));
  if (!values.length) return '<p class="journal-empty">Sin valores para este gráfico en las fechas seleccionadas.</p>';
  const width = 720, height = 250, left = definition.monetary ? 100 : 56, right = 20, top = 20, bottom = 40;
  const low = Math.min(0, ...values);
  const maximum = Math.max(definition.score ? 10 : 0, ...values);
  const high = maximum === low ? low + 1 : maximum;
  const first = Date.parse(rows[0].date), last = Date.parse(rows.at(-1).date);
  const x = date => left + (last === first ? 0.5 : (Date.parse(date) - first) / (last - first)) * (width - left - right);
  const y = value => top + (high - value) / (high - low) * (height - top - bottom);
  let markup = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${journalEscape(definition.title)}"><title>${journalEscape(definition.title)}. Pasa sobre un punto para ver fecha y valor.</title>`;
  for (let tick = 0; tick <= 4; tick++) {
    const value = low + (high - low) * tick / 4;
    markup += `<line x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}" stroke="#304058" stroke-dasharray="3 5"/><text x="${left - 8}" y="${y(value) + 4}" text-anchor="end">${journalNumber(value, digits)}${unit}</text>`;
  }
  for (const item of series) {
    let path = '', connected = false;
    item.points.forEach(([date, value]) => {
      if (!Number.isFinite(value)) { connected = false; return; }
      const tooltip = journalEscape(`${journalDate(date)} · ${item.label}: ${journalNumber(value, digits)}${unit}`);
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
  const amount = (label, key) => `<div><dt>${journalEscape(label)}</dt><dd>${journalFormatAmount(row, key)}</dd></div>`;
  const sizeAddedPercent = Number.isFinite(row.sizeAdded) && Number.isFinite(row.sizeBefore) && row.sizeBefore > 0 ? row.sizeAdded / row.sizeBefore * 100 : null;
  const sizeAddedPercentLabel = Number.isFinite(sizeAddedPercent) ? `${sizeAddedPercent > 0 ? '+' : ''}${journalNumber(sizeAddedPercent)} %` : '—';
  host.innerHTML = `<div class="panel-head"><h2>${journalDate(row.date)}</h2>${JOURNAL_STATUSES[row.status] ? `<span class="journal-badge">${JOURNAL_STATUSES[row.status]}</span>` : ''}</div>
    <div class="journal-detail-block"><h3>Comentario y errores</h3><p class="journal-comment">${journalEscape(row.comment || (typeof row.rest === 'string' && row.rest !== '-' ? row.rest : row.status === 'paused' ? 'Semana de reenfoque. Sin sesión evaluada.' : 'Sin comentario registrado.'))}</p><dl class="journal-values">${field('Puntuación del error', row.errorScore)}${field('Nota general', row.overall)}</dl></div>
    ${JOURNAL_GROUPS.map(group => `<div class="journal-detail-block"><h3>${group.label}</h3><dl class="journal-values">${group.fields.map(([key, label]) => field(label, row[key])).join('')}</dl></div>`).join('')}
    <div class="journal-detail-block"><h3>Resultante · ${journalDisplayUnit()}</h3><dl class="journal-values">${amount('Discrecional', 'discretionary')}${amount('Sistemático', 'systematic')}</dl></div>
    <div class="journal-detail-block"><h3>Size · ${journalDisplayUnit()}</h3><dl class="journal-values">${amount('Antes', 'sizeBefore')}${amount('Después', 'sizeAfter')}${amount('Añadido', 'sizeAdded')}<div><dt>Añadido respecto al size anterior</dt><dd>${sizeAddedPercentLabel}</dd></div></dl></div>
    ${Number.isFinite(row.previousTechnical) || Number.isFinite(row.previousFocus) ? `<div class="journal-detail-block"><h3>Histórico</h3><dl class="journal-values">${field('Análisis técnico anterior', row.previousTechnical)}${field('Focus anterior', row.previousFocus)}</dl></div>` : ''}`;
}

function renderJournal() {
  if (!journalData) return;
  const rows = journalFilteredRows();
  if (!journalMonth) journalMonth = journalCurrentMonth();
  const monthRows = rows.filter(row => row.date.startsWith(journalMonth));
  if (!monthRows.some(row => row.date === journalSelectedDate)) journalSelectedDate = monthRows.filter(row => row.status === 'evaluated').at(-1)?.date || monthRows.at(-1)?.date || '';
  const evaluated = rows.filter(row => Number.isFinite(row.overall));
  const lastSizeRow = rows.filter(row => Number.isFinite(row.sizeAfter)).at(-1);
  const average = evaluated.length ? evaluated.reduce((sum, row) => sum + row.overall, 0) / evaluated.length : null;
  const highErrors = rows.filter(row => Number.isFinite(row.errorScore) && row.errorScore > journalData.settings.errorLimit).length;
  document.getElementById('journal-summary').innerHTML = [['Sesiones con nota', evaluated.length], ['Nota media', journalNumber(average)], ['Último size del período', journalFormatAmount(lastSizeRow, 'sizeAfter')], ['Errores sobre el límite', highErrors]].map(([label, value]) => `<div class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div></div>`).join('');
  const { from, to } = journalDateRange();
  const invalidRange = from && to && from > to;
  document.getElementById('journal-status').textContent = invalidRange ? 'La fecha inicial debe ser anterior o igual a la fecha final.' : `${rows.length} fechas · ${evaluated.length} con nota · ${rows.filter(row => row.status === 'paused').length} en pausa`;
  const missingRisk = journalDisplayUnit() === 'R' ? rows.filter(row => ['sizeBefore', 'sizeAfter', 'sizeAdded', 'discretionary', 'systematic'].some(key => Number.isFinite(row[key]) && journalAmount(row, key) === null)).length : 0;
  if (missingRisk) document.getElementById('journal-status').textContent += ` · ${missingRisk} fechas sin R válida: sus importes no se pueden convertir.`;
  renderJournalCalendar(rows);
  renderJournalDetail(rows);
  renderJournalCharts(rows);
}

function renderJournalCharts(rows = journalFilteredRows()) {
  const definitions = journalChartDefinitions().filter(chart => journalSelectedCharts.has(chart.id));
  const host = document.getElementById('journal-chart-grid');
  document.getElementById('journal-chart-count').textContent = `(${definitions.length})`;
  if (journalView !== 'charts') return;
  host.innerHTML = definitions.length ? [...new Set(definitions.map(chart => chart.group))].map(group => `<section class="journal-chart-category"><h2 class="journal-category-title">${group}</h2><div class="journal-category-grid">${definitions.filter(chart => chart.group === group).map(chart => `<section class="panel journal-chart-card"><h3>${chart.title}${chart.monetary ? ` · ${journalDisplayUnit()}` : ''}</h3>${journalChartSvg(chart, rows)}</section>`).join('')}</div></section>`).join('') : '<div class="panel journal-empty">Selecciona los gráficos que quieras ver en «Mostrar gráficos».</div>';
}

function setJournalView(view) {
  journalView = view;
  for (const key of ['sessions', 'charts', 'entry']) {
    const active = key === view;
    const tab = document.getElementById(`journal-tab-${key}`);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(`journal-${key}`).hidden = !active;
  }
  document.getElementById('journal-chart-menu').hidden = view !== 'charts';
  if (journalData) renderJournalCharts();
}

function journalEntryCalculation(entry, settings) {
  const groups = JOURNAL_GROUPS.slice(1).map(group => group.fields.map(([key]) => entry[key]));
  const scores = groups.flat();
  const valid = scores.every(value => Number.isFinite(value) && value >= 0 && value <= 10);
  const overall = valid ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null;
  const canCalculate = valid && Number.isFinite(entry.sizeBefore) && entry.sizeBefore > 0 && Number.isFinite(entry.errorScore) && entry.errorScore >= 0 && entry.errorScore <= 10;
  const increase = canCalculate ? entry.errorScore > settings.errorLimit ? 0 : settings.maxSessionIncrease * groups.reduce((sum, group) => sum + group.reduce((total, value) => total + value, 0) / group.length, 0) / 30 : null;
  return { overall, sizeAfter: increase === null ? null : entry.sizeBefore * (1 + increase), sizeAdded: increase === null ? null : entry.sizeBefore * increase, sizeAddedPercent: increase === null ? null : increase * 100 };
}

function initializeJournalEntry() {
  const extra = [['discretionary', 'Discrecional · USD'], ['systematic', 'Sistemático · USD'], ['errorScore', 'Puntuación del error'], ['sizeBefore', 'Size antes · USD']];
  const fields = [...JOURNAL_GROUPS.flatMap(group => group.fields), ...extra];
  const input = (key, label, score = false) => `<label for="journal-entry-${key}">${label}<input id="journal-entry-${key}" name="${key}" type="number" step="any" ${score ? 'min="0" max="10"' : key === 'sizeBefore' ? 'min="0"' : ''} inputmode="decimal"></label>`;
  document.getElementById('journal-entry-fields').innerHTML = JOURNAL_GROUPS.map(group => `<fieldset><legend>${group.label} · 0–10</legend><div class="journal-entry-inputs">${group.fields.map(([key, label]) => input(key, label, true)).join('')}</div></fieldset>`).join('') + `<fieldset><legend>Resultante · USD</legend><div class="journal-entry-inputs">${extra.slice(0, 2).map(([key, label]) => input(key, label)).join('')}</div></fieldset><fieldset><legend>Size y errores</legend><div class="journal-entry-inputs">${extra.slice(2).map(([key, label]) => input(key, label, key === 'errorScore')).join('')}</div></fieldset><fieldset class="journal-entry-comment"><legend>Comentario y errores del día</legend><label for="journal-entry-comment">Comentario<textarea id="journal-entry-comment" name="comment" rows="4"></textarea></label></fieldset>`;
  const dateInput = document.getElementById('journal-entry-date');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  dateInput.value = dateFieldFromIso(['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-'));
  attachDatePicker(dateInput);
  const read = () => ({ date: dateFieldToIso(dateInput.value), comment: document.getElementById('journal-entry-comment').value, ...Object.fromEntries(fields.map(([key]) => {
    const raw = document.getElementById(`journal-entry-${key}`).value.trim();
    return [key, raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : null];
  })) });
  const render = save => {
    const entry = read();
    const result = journalEntryCalculation(entry, journalData.settings);
    const value = (number, suffix = '') => Number.isFinite(number) ? `${journalNumber(number, suffix === ' USD' ? 6 : 2)}${suffix}` : '—';
    document.getElementById('journal-entry-calculated').innerHTML = [['Nota general', value(result.overall)], ['Size después · USD', value(result.sizeAfter, ' USD')], ['Size añadido · USD', value(result.sizeAdded, ' USD')], ['Size añadido · %', value(result.sizeAddedPercent, ' %')]].map(([label, number]) => `<div class="metric"><div class="metric-label">${label}</div><output class="metric-value">${number}</output></div>`).join('');
    let message = 'Importes en USD. Envía una captura con la fecha, todos los campos y el resumen calculado.';
    if (!entry.date) message = 'Introduce una fecha válida en formato dd/mm/aaaa.';
    if (save && entry.date && /^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
      try { localStorage.setItem(`track-journal-entry-${entry.date}`, JSON.stringify(entry)); message = 'Borrador guardado en este navegador. ' + message; } catch { message = 'No se pudo guardar el borrador en este navegador. ' + message; }
    }
    document.getElementById('journal-entry-status').textContent = message;
  };
  const load = () => {
    if (!dateFieldToIso(dateInput.value)) {
      document.getElementById('journal-entry-status').textContent = 'Introduce una fecha válida en formato dd/mm/aaaa.';
      return;
    }
    let entry = journalData.sessions.find(row => row.date === dateFieldToIso(dateInput.value)) || {};
    try { const draft = JSON.parse(localStorage.getItem(`track-journal-entry-${dateFieldToIso(dateInput.value)}`)); if (draft && draft.date === dateFieldToIso(dateInput.value)) entry = draft; } catch {}
    for (const [key] of fields) document.getElementById(`journal-entry-${key}`).value = Number.isFinite(entry[key]) ? String(entry[key]) : '';
    document.getElementById('journal-entry-comment').value = typeof entry.comment === 'string' ? entry.comment : '';
    if (!Number.isFinite(entry.sizeBefore)) document.getElementById('journal-entry-sizeBefore').value = String(journalData.sessions.filter(row => row.date < dateFieldToIso(dateInput.value) && Number.isFinite(row.sizeAfter)).at(-1)?.sizeAfter ?? journalData.settings.baseSize);
    render(false);
  };
  dateInput.addEventListener('change', load);
  document.getElementById('journal-entry-form').addEventListener('input', event => { if (event.target !== dateInput) render(true); });
  document.getElementById('journal-entry-form').addEventListener('submit', event => event.preventDefault());
  load();
}

function saveJournalCharts() {
  try { localStorage.setItem('track-journal-charts-v2', JSON.stringify([...journalSelectedCharts])); } catch {}
  document.querySelectorAll('[data-journal-chart]').forEach(input => { input.checked = journalSelectedCharts.has(input.dataset.journalChart); });
  if (journalData) renderJournalCharts();
}

async function initializeJournal() {
  const definitions = journalChartDefinitions();
  try {
    const stored = JSON.parse(localStorage.getItem('track-journal-charts-v2'));
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
  const views = ['sessions', 'charts', 'entry'];
  for (const view of views) {
    const tab = document.getElementById(`journal-tab-${view}`);
    tab.addEventListener('click', () => setJournalView(view));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const target = event.key === 'Home' ? views[0] : event.key === 'End' ? views.at(-1) : views[(views.indexOf(view) + (event.key === 'ArrowLeft' ? -1 : 1) + views.length) % views.length];
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
  document.getElementById('journal-calendar').addEventListener('click', selectDay);
  document.getElementById('journal-month').addEventListener('change', event => {
    if (!/^\d{4}-\d{2}$/.test(event.target.value)) return;
    journalMonth = event.target.value;
    journalSelectedDate = '';
    renderJournal();
  });
  for (const [id, offset] of [['journal-month-prev', -1], ['journal-month-next', 1]]) document.getElementById(id).addEventListener('click', () => {
    if (!journalData) return;
    journalMonth = journalShiftMonth(journalMonth || journalCurrentMonth(), offset);
    journalSelectedDate = '';
    renderJournal();
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
    initializeJournalEntry();
    renderJournal();
  } catch {
    document.getElementById('journal-status').textContent = 'No se ha podido cargar el diario. Recarga la página para volver a intentarlo.';
  }
}
