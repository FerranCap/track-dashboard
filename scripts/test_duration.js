'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const elements = new Map();
const context = vm.createContext({ document: { getElementById(id) {
  if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', clientWidth: 800, clientHeight: 275, setAttribute() {} });
  return elements.get(id);
} } });
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'dashboard.js'), 'utf8');
vm.runInContext(source.slice(0, source.indexOf("$('search').addEventListener")), context);
for (const file of ['help.js', 'consistency.js', 'workspace.js', 'duration.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
}
const evaluate = code => vm.runInContext(code, context);
context.rows = [
  { pnl: 10, entryQty: 10, holdMinutes: 0 },
  { pnl: -4, entryQty: 20, holdMinutes: 4 },
  { pnl: 6, entryQty: null, holdMinutes: 5 },
  { pnl: 0, entryQty: 10, holdMinutes: 9 },
  { pnl: -2, entryQty: 5, holdMinutes: null },
  { pnl: 4, entryQty: Infinity, holdMinutes: -1 }
].map((trade, index) => ({ ...trade, id: String(index), symbol: 'SAMPLE', date: '2026-11-06', fees: 0.1 }));
const snapshot = JSON.stringify(context.rows);
evaluate('globalThis.groups = durationStudyGroups(rows, 5)');
assert.deepEqual(Array.from(context.groups, group => group.count), [2, 2, 2]);
const first = context.groups[0], second = context.groups[1];
assert.equal(first.pnl, 6);
assert.equal(first.winRate, 50);
assert.equal(first.rr, 2.5);
assert.equal(first.pf, 2.5);
assert.equal(first.quantity, 30);
assert.equal(first.averageQuantity, 15);
assert.equal(first.pnlPerShare, 0.2);
assert.equal(second.quantityCount, 1);
assert.equal(second.averageQuantity, 10);
assert.equal(second.pnlPerShare, 0, 'PnL per share only uses trades with valid entry quantities');
assert.equal(second.rr, null, 'RR requires both winning and losing trades');
assert.equal(second.pf, Infinity);
assert.equal(context.groups[2].unknown, true);
assert.equal(context.groups.reduce((total, group) => total + group.pnl, 0), 14);
const summary = evaluate('durationSummary(rows.slice(0, 4))');
assert.equal(summary.mean, 4.5);
assert.equal(summary.median, 4.5);
assert.equal(summary.q1, 3);
assert.equal(summary.q3, 6);
assert.ok(Math.abs(summary.p90 - 7.8) < 1e-10);
for (const width of [1, 5, 10, 15, 30, 60]) {
  elements.set('duration-range-width', { value: String(width) });
  evaluate('renderDurationStudies(rows)');
  const groups = evaluate(`durationStudyGroups(rows, ${width})`);
  assert.equal(groups.reduce((total, group) => total + group.count, 0), 6);
  assert.equal(groups.reduce((total, group) => total + group.pnl, 0), 14);
  assert.match(elements.get('duration-table').innerHTML, /Sin duración/);
  assert.match(elements.get('duration-table').innerHTML, /∞/);
  assert.match(elements.get('duration-study-note').textContent, /2 sin duración/);
  const configs = evaluate('[...chartConfigs.values()]');
  assert.equal(configs.length, 11);
  for (const config of configs) assert.ok(config.series.every(series => series.values.every(point => Number.isFinite(point[1]))));
  for (const [id, element] of elements) if (id.endsWith('-chart') || id.startsWith('duration-scatter-')) {
    assert.ok(!/NaN|Infinity|undefined/.test(element.innerHTML), id);
  }
}
assert.equal((elements.get('duration-scatter-pnl').innerHTML.match(/<circle /g) || []).length, 4);
assert.equal((elements.get('duration-scatter-quantity').innerHTML.match(/<circle /g) || []).length, 3);
assert.equal(JSON.stringify(context.rows), snapshot, 'Duration studies do not change trade accounting');
evaluate('renderDurationStudies(rows.slice(0, 1))');
assert.match(elements.get('duration-scatter-pnl').innerHTML, /<svg/);
evaluate('renderDurationStudies([])');
assert.match(elements.get('duration-table').innerHTML, /Sin operaciones/);
assert.ok(!elements.get('duration-stats').innerHTML.includes('NaN'));
assert.ok(!elements.get('duration-scatter-pnl').innerHTML.includes('<circle'));
evaluate('renderDurationStudies(rows.slice(4))');
assert.match(elements.get('duration-table').innerHTML, /Sin duración/);
assert.ok(!elements.get('duration-pnl-chart').innerHTML.includes('<rect'));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const id of elements.keys()) assert.ok(html.includes(`id="${id}"`), `Missing duration render target ${id}`);
const realRows = JSON.parse(fs.readFileSync(path.join(root, 'data', 'trades.json'), 'utf8')).trades;
context.rows = realRows;
evaluate('renderDurationStudies(rows); globalThis.groups = durationStudyGroups(rows, 5)');
assert.equal(context.groups.reduce((total, group) => total + group.count, 0), realRows.length);
const expectedPnl = realRows.reduce((total, trade) => total + trade.pnl, 0);
assert.ok(Math.abs(context.groups.reduce((total, group) => total + group.pnl, 0) - expectedPnl) < 1e-6);
for (const [id, element] of elements) if (id.endsWith('-chart') || id.startsWith('duration-scatter-')) {
  assert.ok(!/NaN|Infinity|undefined/.test(element.innerHTML), `Real dataset chart ${id}`);
}
console.log('Duration boundaries, quantiles, ratios, share denominators, unknowns, chart rendering and empty filters verified.');
