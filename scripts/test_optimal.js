'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const context = vm.createContext({ Intl, console });
for (const file of ['consistency.js', 'workspace.js', 'optimal.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
}
const evaluate = source => vm.runInContext(source, context);
const plain = value => JSON.parse(JSON.stringify(value));
assert.deepEqual(plain(evaluate(`optimalPath([
  {pnl:1,minimum:-2,maximum:6,drawdown:5},
  {pnl:-2,minimum:-4,maximum:0,drawdown:4},
  {pnl:12,minimum:0,maximum:12,drawdown:0}
])`)), { pnl: 11, drawdown: 9, minimum: -3 }, 'Drawdowns must carry previous peaks across sessions');
context.history = [{ effectiveDate: '2026-01-01', risk: 10 }];
context.rows = Array.from({ length: 20 }, (_, index) => {
  const date = `2026-03-${String(index + 1).padStart(2, '0')}`;
  return [
    { id: `win-${index}`, pnl: 20, opened: `${date}T09:00:00-04:00`, closed: `${date}T09:01:00-04:00` },
    { id: `loss-${index}`, pnl: -10, opened: `${date}T09:02:00-04:00`, closed: `${date}T09:03:00-04:00` }
  ];
}).flat();
const baseline = JSON.stringify(context.rows);
evaluate('globalThis.sample = optimalSample(rows, history); globalThis.simulation = optimalSimulations(sample, 20);');
assert.equal(context.sample.trades.length, 40);
assert.equal(context.sample.sessions.length, 20);
assert.deepEqual(plain(context.sample.historical), { pnl: 20, drawdown: 1, minimum: 0 });
assert.equal(JSON.stringify(context.rows), baseline, 'Normalization must not change source trades');
assert.equal(evaluate('optimalSample(rows, []).excluded'), 40);
assert.equal(evaluate("optimalSample([{id:'invalid',pnl:1,opened:'invalid',closed:'invalid'}],history).excluded"), 1);
assert.equal(evaluate("optimalSample([{id:'utc',pnl:10,opened:'2026-03-02T02:00:00Z',closed:'2026-03-02T02:01:00Z'}],history).sessions[0].date"), '2026-03-01');
assert.equal(evaluate("optimalSample([{id:'overnight',pnl:10,opened:'2026-03-01T09:00:00-05:00',closed:'2026-03-02T09:00:00-05:00'}],history).overlapping"), true);
assert.equal(evaluate("optimalSample([{...rows[0],pnl:20},{...rows[0],id:'same-close',pnl:-20}],history).historical.drawdown"), 0, 'Simultaneous closes must be grouped');
assert.deepEqual(plain(evaluate('optimalSimulations(sample,20)')), plain(context.simulation), 'Identical filters must give reproducible simulations');
assert.equal(context.simulation.paths.length, 1000);
assert.equal(context.simulation.median, 20);
assert.equal(context.simulation.drawdown95, 1, 'Intra-session drawdowns must survive resampling');
evaluate('globalThis.sizing = optimalSizing(sample,simulation,1000,25,10,5)');
assert.equal(context.sizing.selected.size, 2.5);
assert.equal(context.sizing.selected.adverseDrawdown, 25);
assert.equal(context.sizing.selected.acceptable, true);
assert.equal(context.sizing.candidates.find(item => item.size === 2.75).acceptable, false);
assert.equal(context.sizing.candidates.find(item => item.size === 1.25).median, 250);
assert.equal(context.sizing.candidates.find(item => item.size === 0).adverseDrawdown, 0);
assert.equal(evaluate('optimalSizing({...sample,trades:sample.trades.slice(0,29)},simulation,1000,25,10,5).selected'), null);
assert.equal(evaluate('optimalSizing({...sample,overlapping:true},simulation,1000,25,10,5).selected'), null);
assert.equal(evaluate('optimalSizing({...sample,trades:sample.trades.map(t=>({...t,value:1}))},simulation,1000,25,10,5).selected'), null);
assert.equal(evaluate('optimalSizing(sample,{...simulation,median:-1},1000,25,10,5).selected'), null);
assert.equal(evaluate('optimalSizing(sample,simulation,1000,0.01,10,5).selected'), null);
assert.equal(evaluate('optimalSizing(sample,simulation,1000,25,10,0.5).selected.size'), 0.5);
evaluate('globalThis.depleted = {...simulation,minimum:-100,paths:simulation.paths.map(p=>({...p,minimum:-100}))}');
assert.equal(evaluate('optimalSizing(sample,depleted,1000,25,10,5).selected.size'), 0.99);
assert.equal(evaluate('optimalSizing(sample,depleted,1000,25,10,5).candidates.find(c=>c.size===1).bankruptPercent'), 100);
for (const expression of [
  'optimalSimulations(sample,0)', 'optimalSimulations(sample,1.5)', 'optimalSimulations(sample,1001)',
  'optimalSizing(sample,simulation,1000,1000,10,5)', 'optimalSizing(sample,simulation,NaN,25,10,5)',
  'optimalSizing(sample,simulation,1000,25,0,5)', 'optimalSizing(sample,simulation,1000,25,10,21)'
]) assert.throws(() => evaluate(expression));
const inputs = { 'optimal-capital': '10000', 'optimal-drawdown': '10', 'optimal-drawdown-unit': 'percent', 'optimal-horizon': '100', 'optimal-maximum': '5' };
const nodes = new Map();
context.$ = id => {
  if (!nodes.has(id)) nodes.set(id, { value: inputs[id] || '', innerHTML: '', textContent: '', addEventListener() {} });
  return nodes.get(id);
};
context.mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
context.num = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : '—';
context.money = context.signed = value => Number.isFinite(value) ? value.toFixed(2) : '—';
context.pct = (a, b) => b ? `${a / b * 100}%` : '—';
context.consistencyMetric = (label, value) => `${label}:${value}`;
context.tableMarkup = (headers, rows) => JSON.stringify([headers, rows]);
const charts = new Map();
context.renderChart = (id, series) => charts.set(id, series);
evaluate('sessionRiskHistory=history; renderOptimal(rows); initializeOptimal();');
assert.ok(nodes.get('optimal-result-status').textContent.includes('Mayor tamaño'));
assert.equal(charts.get('optimal-return-chart').length, 3);
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const id of nodes.keys()) assert.ok(html.includes(`id="${id}"`), `Missing HTML node ${id}`);
nodes.get('optimal-capital').value = '';
evaluate('renderOptimal(rows)');
assert.ok(nodes.get('optimal-result-status').textContent.includes('Indica capital'));
assert.ok(charts.get('optimal-return-chart').every(series => series.values.length === 0), 'Invalid input must clear previous charts');
nodes.get('optimal-capital').value = '10000';
nodes.get('optimal-drawdown-unit').value = 'usd';
nodes.get('optimal-drawdown').value = '1000';
evaluate('renderOptimal(rows)');
const usdStatus = nodes.get('optimal-result-status').textContent;
nodes.get('optimal-drawdown-unit').value = 'percent';
nodes.get('optimal-drawdown').value = '10';
evaluate('renderOptimal(rows)');
assert.equal(nodes.get('optimal-result-status').textContent, usdStatus, 'USD and percent limits must agree');
evaluate('renderOptimal([])');
assert.ok(nodes.get('optimal-result-status').textContent.includes('Sin operaciones'));
evaluate('renderOptimal(rows.filter(trade => trade.pnl < 0))');
assert.ok(!nodes.get('optimal-result-status').textContent.includes('Mayor tamaño'), 'Global filters must invalidate the previous selection');
assert.ok(charts.get('optimal-return-chart')[1].values.some(point => point[1] < 0));
context.dataset = JSON.parse(fs.readFileSync(path.join(root, 'data/trades.json'), 'utf8'));
context.realHistory = JSON.parse(fs.readFileSync(path.join(root, 'data/session-risk.json'), 'utf8'));
const actualBefore = JSON.stringify(context.dataset);
evaluate('sessionRiskHistory=realHistory; renderOptimal(dataset.trades)');
assert.equal(JSON.stringify(context.dataset), actualBefore, 'Actual accounting must remain immutable');
assert.ok(charts.get('optimal-return-chart').every(series => series.values.every(point => Number.isFinite(point[1]))));
console.log('Optimal risk: normalization, sessions, intraday drawdowns, reproducibility, constraints, empty states and real-data rendering verified.');
console.log(nodes.get('optimal-result-status').textContent);
