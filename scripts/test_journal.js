'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/journal.json'), 'utf8'));
const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', textContent: '', hidden: false, dataset: {}, handlers: {}, attributes: {},
    addEventListener(type, handler) { this.handlers[type] = handler; },
    setAttribute(name, value) { this.attributes[name] = value; }, focus() { this.focused = true; } });
  return elements.get(id);
}
const presets = ['all', 'none', 'default'].map(name => Object.assign(element(`preset-${name}`), { dataset: { journalPreset: name } }));
const storage = new Map();
const generalCriteria = { from: '', to: '' };
const context = vm.createContext({
  tradeFilterPanels: new Map([['general', { appliedCriteria: generalCriteria }]]),
  document: { getElementById: element, querySelectorAll(selector) { return selector === '[data-journal-preset]' ? presets : []; } },
  localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  fetch: async () => ({ ok: true, json: async () => JSON.parse(JSON.stringify(data)) })
});
vm.runInContext(fs.readFileSync(path.join(root, 'journal.js'), 'utf8'), context);
const evaluate = source => vm.runInContext(source, context);

async function run() {
  await evaluate('initializeJournal()');
  assert.equal(data.sessions.length, 32);
  assert.equal(data.sessions.filter(row => row.status === 'evaluated').length, 20);
  assert.equal(data.sessions.filter(row => row.status === 'paused').length, 5);
  assert.equal(data.sessions.filter(row => row.status === 'incomplete').length, 6);
  assert.equal(new Set(data.sessions.map(row => row.date)).size, 32);
  assert.ok(element('journal-status').textContent.includes('20 con nota'));
  assert.ok(element('journal-session-detail').innerHTML.includes('22/10/2026'));
  assert.ok(element('journal-session-table').innerHTML.includes('aria-pressed="true"'));
  assert.ok(element('journal-calendar').innerHTML.includes('data-journal-date="2026-10-22" aria-pressed="true"'));
  assert.ok(element('journal-calendar').innerHTML.includes('Nota 0'));
  element('journal-calendar').handlers.click({ target: { closest: () => ({ dataset: { journalDate: '2026-10-19' }, disabled: false }) } });
  assert.ok(element('journal-session-detail').innerHTML.includes('19/10/2026'));
  assert.ok(element('journal-session-detail').innerHTML.includes('4,51'));
  element('journal-month-prev').handlers.click();
  assert.equal(element('journal-month').value, '2026-09');
  assert.ok(element('journal-session-detail').innerHTML.includes('30/09/2026'));
  assert.equal(element('journal-month-prev').disabled, true);
  element('journal-calendar').handlers.click({ target: { closest: () => ({ dataset: { journalDate: '2026-09-21' }, disabled: false }) } });
  assert.ok(element('journal-session-detail').innerHTML.includes('Sin evaluar'));
  element('journal-month-next').handlers.click();
  assert.equal(element('journal-month').value, '2026-10');
  element('journal-calendar').handlers.click({ target: { closest: () => ({ dataset: { journalDate: '2026-10-23' }, disabled: false }) } });
  assert.ok(element('journal-session-detail').innerHTML.includes('Pendiente'));

  let previousSize = data.settings.baseSize;
  for (const row of data.sessions) {
    if (row.status !== 'evaluated') continue;
    const blockMeans = [[row.fundamentalAnalysis, row.fundamentalTracking], [row.volume, row.managementLevels, row.riskReward, row.technicalTracking], [row.exitDiscipline, row.entryDiscipline, row.sizing]].map(values => values.reduce((sum, value) => sum + value, 0) / values.length);
    const allScores = [row.fundamentalAnalysis, row.fundamentalTracking, row.volume, row.managementLevels, row.riskReward, row.technicalTracking, row.exitDiscipline, row.entryDiscipline, row.sizing];
    assert.ok(Math.abs(row.overall - allScores.reduce((sum, value) => sum + value, 0) / 9) < 1e-10);
    const expectedSize = row.errorScore > data.settings.errorLimit ? previousSize : previousSize * (1 + data.settings.maxSessionIncrease * blockMeans.reduce((sum, value) => sum + value, 0) / 30);
    assert.ok(Math.abs(row.sizeBefore - previousSize) < 1e-10);
    assert.ok(Math.abs(row.sizeAfter - expectedSize) < 1e-10);
    previousSize = row.sizeAfter;
  }
  assert.equal(data.sessions.find(row => row.date === '2026-09-18').previousTechnical, 7);
  assert.equal(data.sessions.find(row => row.date === '2026-10-21').overall, 0);
  assert.equal(data.sessions.find(row => row.date === '2026-09-21').overall, '-');
  assert.equal(data.sessions.find(row => row.date === '2026-10-23').overall, null);
  assert.equal(evaluate("journalNumber(0)"), '0');
  assert.equal(evaluate("journalNumber(null)"), '—');
  assert.equal(evaluate("journalNumber('-')"), 'Sin evaluar');
  assert.equal(evaluate("journalGroupValue(journalData.sessions.find(row => row.status === 'paused'), JOURNAL_GROUPS[0])"), null);

  generalCriteria.from = '2026-10-19';
  generalCriteria.to = '2026-10-22';
  evaluate('renderJournal()');
  assert.equal(evaluate('journalFilteredRows().length'), 4);
  assert.ok(element('journal-status').textContent.includes('4 con nota'));
  generalCriteria.from = '2026-10-23';
  generalCriteria.to = '2026-10-19';
  evaluate('renderJournal()');
  assert.ok(element('journal-status').textContent.includes('fecha inicial'));
  assert.equal(evaluate('journalFilteredRows().length'), 0);
  generalCriteria.from = '';
  generalCriteria.to = '';
  evaluate('renderJournal()');

  element('journal-tab-charts').handlers.click();
  assert.equal(element('journal-charts').hidden, false);
  assert.equal(element('journal-sessions').hidden, true);
  assert.equal(element('journal-tab-charts').attributes['aria-selected'], 'true');
  assert.equal((element('journal-chart-grid').innerHTML.match(/journal-chart-card/g) || []).length, 3);
  presets[0].handlers.click();
  assert.equal(evaluate('journalSelectedCharts.size'), evaluate('journalChartDefinitions().length'));
  assert.ok(!/NaN|Infinity|undefined/.test(element('journal-chart-grid').innerHTML));
  presets[1].handlers.click();
  assert.equal(storage.get('track-journal-charts-v1'), '[]');
  assert.ok(element('journal-chart-grid').innerHTML.includes('Selecciona los gráficos'));
  await evaluate('initializeJournal()');
  assert.equal(evaluate('journalSelectedCharts.size'), 0, 'An intentionally empty selection survives reload');
  presets[2].handlers.click();
  assert.equal(evaluate('journalSelectedCharts.size'), 3);

  const gapChart = evaluate("journalChartSvg(journalChartDefinitions()[0], journalData.sessions)");
  assert.ok((gapChart.match(/M[0-9]/g) || []).length >= 3, 'Missing and paused sessions break chart lines');
  assert.ok(gapChart.includes('21/10/2026 · Nota general: 0'));
  assert.ok(!gapChart.includes('23/10/2026 · Nota general: 0'));
  evaluate("journalSelectedDate = '2026-10-12'; renderJournal()");
  assert.ok(element('journal-session-detail').innerHTML.includes('SEMANA DE REENFOQUE'));
  evaluate("journalData.sessions[0].comment = '<img src=x onerror=alert(1)>'; journalSelectedDate = journalData.sessions[0].date; journalMonth = journalSelectedDate.slice(0, 7); renderJournal()");
  assert.ok(!element('journal-session-detail').innerHTML.includes('<img'));
  assert.ok(element('journal-session-detail').innerHTML.includes('&lt;img'));
  context.fetch = async () => ({ ok: false, status: 500 });
  await evaluate('initializeJournal()');
  assert.ok(element('journal-status').textContent.includes('No se ha podido cargar'));
  console.log('Journal import accounting, missing states, date filters, session details, chart selection, persistence, escaping and load failure checks passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
