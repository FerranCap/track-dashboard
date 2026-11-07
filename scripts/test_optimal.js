'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const nodes = new Map();
const context = vm.createContext({ Intl, console, document: { getElementById(id) {
  assert.ok(html.includes(`id="${id}"`), `Missing HTML target ${id}`);
  if (!nodes.has(id)) nodes.set(id, {
    value: id === 'optimal-target-risk' ? '10' : '', innerHTML: '', textContent: '',
    clientWidth: 800, clientHeight: 340, setAttribute() {}, addEventListener(event, handler) { this[event] = handler; }
  });
  return nodes.get(id);
} } });
vm.runInContext(fs.readFileSync(path.join(root, 'dashboard.js'), 'utf8').split("$('search').addEventListener")[0], context);
for (const file of ['help.js', 'consistency.js', 'workspace.js', 'optimal.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
const evaluate = source => vm.runInContext(source, context);
const plain = value => JSON.parse(JSON.stringify(value));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
context.history = [{ effectiveDate: '2026-01-01', risk: 100 }, { effectiveDate: '2026-03-03', risk: 200 }];
context.rows = [
  { id: 'win-a', pnl: 4, opened: '2026-03-01T09:00:00-05:00' },
  { id: 'loss-a', pnl: -1, opened: '2026-03-01T09:01:00-05:00' },
  { id: 'win-b', pnl: 8, opened: '2026-03-03T09:00:00-05:00' },
  { id: 'loss-b', pnl: -6, opened: '2026-03-03T09:01:00-05:00' },
  { id: 'zero', pnl: 0, opened: '2026-03-03T09:02:00-05:00' }
].map(trade => ({ ...trade, closed: new Date(Date.parse(trade.opened) + 30000).toISOString() }));
const original = JSON.stringify({ rows: context.rows, history: context.history });
evaluate('globalThis.sample = optimalSample(rows,history); globalThis.sizing = optimalSizing(sample,10);');
assert.equal(context.sample.trades.length, 5);
assert.equal(context.sample.sessions, 2);
close(context.sample.averageLoss, 0.02);
close(context.sample.averageWin, 0.04);
close(context.sample.expectancy, 0.008);
close(context.sample.kelly, 0.25);
close(context.sizing.selected.size, 5);
close(context.sizing.selected.averageLoss, 0.1);
close(context.sizing.selected.averageWin, 0.2);
close(context.sizing.selected.expectancy, 0.04);
evaluate('globalThis.curves = optimalEquityCurves(sample,sizing.selected)');
assert.equal(context.curves.series.length, 3);
assert.equal(context.curves.tradeCount, 5);
assert.equal(context.curves.closeCount, 5);
for (const scenario of context.curves.series) assert.equal(scenario.values[0][1], 0);
close(context.curves.series[0].values.at(-1)[1], 0.04);
close(context.curves.series[1].values.at(-1)[1], 0.2);
close(context.curves.series[2].values.at(-1)[1], 0.5);
close(context.curves.series[0].values[2][1], 0.03, 'Closed losses must reduce accumulated R');
assert.deepEqual(plain(evaluate('optimalEquityCurves(optimalSample(rows.slice().reverse(),history),sizing.selected)')), plain(context.curves), 'Curve order follows execution closes, not input order');
context.simultaneous = context.rows.slice(0, 2).map(trade => ({ ...trade, closed: context.rows[0].closed }));
evaluate('globalThis.simultaneousCurves=optimalEquityCurves(optimalSample(simultaneous,history),sizing.selected)');
assert.equal(context.simultaneousCurves.tradeCount, 2);
assert.equal(context.simultaneousCurves.closeCount, 1);
assert.equal(context.simultaneousCurves.series[0].values.length, 2, 'Simultaneous closes share one accumulated point after the origin');
close(context.simultaneousCurves.series[0].values.at(-1)[1], 0.03);
assert.equal(JSON.stringify({ rows: context.rows, history: context.history }), original);
assert.equal(evaluate('optimalSample(rows,[]).excluded'), 5);
assert.equal(evaluate("optimalSample([{id:'bad',pnl:1,opened:'invalid'}],history).excluded"), 1);
assert.equal(evaluate("optimalSample([{id:'utc',pnl:-1,opened:'2026-03-03T02:00:00Z'}],history).averageLoss"), 0.01, 'Risk lookup must use the New York entry date');
assert.equal(evaluate('optimalSizing(sample,0).selected.size'), 0);
assert.equal(evaluate('optimalSizing(optimalSample([],history),10).selected'), null);
assert.equal(evaluate('optimalSizing(optimalSample(rows.filter(t=>t.pnl>=0),history),10).selected'), null);
context.sameAverageRows = context.rows.map(trade => ({ ...trade, pnl: trade.id === 'loss-a' ? -2 : trade.id === 'loss-b' ? -4 : trade.pnl }));
close(evaluate('optimalSizing(optimalSample(sameAverageRows,history),10).selected.size'), 5, 'Extreme individual losses must not set sizing');
assert.deepEqual(plain(evaluate('optimalSample(sameAverageRows,history).kelly')), plain(context.sample.kelly));
close(evaluate('optimalSample(rows.filter(t=>t.pnl!==0),history).kelly'), 0.25, 'Zero trades must not be treated as losses by Kelly');
close(evaluate('optimalKellyGrowth(sample,10)'), (0.4 * Math.log(1.2) + 0.4 * Math.log(0.9)) * 100);
close(evaluate('optimalKellyGrowth(optimalSample(rows.filter(t=>t.pnl!==0),history),10) * 0.8'), evaluate('optimalKellyGrowth(sample,10)'));
assert.equal(evaluate('optimalKellyGrowth(sample,100)'), null);
assert.equal(evaluate('optimalKellyGrowth(sample,101)'), null);
assert.equal(evaluate('optimalKellyGrowth(sample,0)'), 0);
for (const percent of [0, 5, 10, 20, 24.9, 25.1, 30, 50, 90]) assert.ok(evaluate(`optimalKellyGrowth(sample,25) >= optimalKellyGrowth(sample,${percent})`), 'Kelly marker must maximize the mean-based curve');
const interpolated = context.sizing.candidates.map(item => item.percent);
assert.ok(interpolated.includes(2) && interpolated.includes(25) && interpolated.includes(10));
assert.ok(context.sizing.candidates.some(item => item.percent > 2 && item.percent < 25));
close(evaluate('optimalSample(rows.filter(t=>t.pnl<0),history).kelly'), 0);
assert.equal(evaluate('optimalSizing(optimalSample(rows.filter(t=>t.pnl<0),history),10).selected.size'), 5, 'Loss-only samples can still calculate the mean-based size');
assert.equal(evaluate('optimalSample(rows.filter(t=>t.pnl>=0),history).kelly'), null);
for (const target of ['NaN', 'Infinity', '-1', '101']) assert.throws(() => evaluate(`optimalSizing(sample,${target})`));
evaluate('sessionRiskHistory=history; renderOptimal(rows); initializeOptimal();');
assert.ok(nodes.get('optimal-result-status').textContent.includes('5.000'));
assert.ok(nodes.get('optimal-kelly-legend').innerHTML.includes('25.00% de R'));
assert.ok(nodes.get('optimal-kelly-chart').innerHTML.includes('<svg'));
assert.ok(nodes.get('optimal-equity-chart').innerHTML.includes('<svg'));
assert.ok(nodes.get('optimal-equity-legend').innerHTML.includes('0.200 R'));
assert.ok(nodes.get('optimal-equity-legend').innerHTML.includes('0.500 R'));
assert.ok(!/NaN|Infinity|undefined|USD|\$/.test(nodes.get('optimal-equity-chart').innerHTML));
assert.ok(nodes.get('optimal-kelly-chart').innerHTML.includes('Histórico'));
assert.ok(nodes.get('optimal-kelly-chart').innerHTML.includes('Kelly óptimo teórico'));
assert.ok(!/NaN|Infinity|undefined|USD|\$/.test(nodes.get('optimal-kelly-chart').innerHTML));
for (const width of [280, 320, 800]) {
  context.chartWidth = width;
  const markup = evaluate('svgChart([],{optimalKelly:{sample,targetPercent:10},width:chartWidth,height:340})');
  assert.ok(markup.includes('<svg') && !/NaN|Infinity|undefined/.test(markup));
}
const largeLoss = evaluate('optimalSample(rows.map(t=>({...t,pnl:t.pnl*100})),history)');
context.largeLoss = largeLoss;
assert.ok(evaluate('optimalKellySvg({sample:largeLoss,targetPercent:100})').includes('Fuera del dominio'));
nodes.get('optimal-target-risk').value = '20';
evaluate('filtered=rows');
nodes.get('optimal-target-risk').input();
assert.ok(nodes.get('optimal-result-status').textContent.includes('10.000'), 'The configured percentage must update the size immediately');
assert.ok(nodes.get('optimal-equity-legend').innerHTML.includes('0.400 R'), 'The chosen curve must update with the configured percentage');
nodes.get('optimal-target-risk').value = '';
evaluate('renderOptimal(rows)');
assert.ok(nodes.get('optimal-result-status').textContent.includes('Indica una pérdida media'));
assert.ok(!nodes.get('optimal-kelly-legend').innerHTML.includes('20.00% de R'), 'Invalid input must clear the previous selected marker');
assert.equal(evaluate("chartConfigs.get('optimal-equity-chart').series[1].values.length"), 0, 'Invalid input must clear the chosen curve');
nodes.get('optimal-target-risk').value = '10';
evaluate('renderOptimal(rows.filter(t=>t.pnl<0))');
assert.ok(nodes.get('optimal-kelly-note').textContent.includes('0% de R'));
assert.ok(evaluate("chartConfigs.get('optimal-equity-chart').series[2].values.every(point=>point[1]===0)"), 'A zero Kelly size must produce a flat curve');
evaluate('renderOptimal([])');
assert.ok(nodes.get('optimal-result-status').textContent.includes('Sin trades'));
assert.ok(!nodes.get('optimal-kelly-chart').innerHTML.includes('<svg'), 'Empty filters must clear the curve');
assert.ok(!nodes.get('optimal-equity-chart').innerHTML.includes('<svg'), 'Empty filters must clear accumulated curves');
context.realDataset = JSON.parse(fs.readFileSync(path.join(root, 'data/trades.json'), 'utf8'));
context.realHistory = JSON.parse(fs.readFileSync(path.join(root, 'data/session-risk.json'), 'utf8'));
const datasetBefore = JSON.stringify(context.realDataset);
evaluate('sessionRiskHistory=realHistory; renderOptimal(realDataset.trades)');
assert.equal(JSON.stringify(context.realDataset), datasetBefore);
assert.ok(nodes.get('optimal-kelly-chart').innerHTML.includes('<svg'));
assert.ok(!/NaN|Infinity|undefined|USD|\$/.test(nodes.get('optimal-kelly-chart').innerHTML));
evaluate('refreshCharts()');
assert.ok(nodes.get('optimal-kelly-chart').innerHTML.includes('<svg'), 'The curve must survive navigation and resize refreshes');
assert.ok(nodes.get('optimal-equity-chart').innerHTML.includes('<svg'), 'Accumulated curves must survive navigation and resize refreshes');
console.log('Optimal risk: loss-only averages, changing historical R, sizing, Kelly maxima, zeros, extremes, chart rendering, inputs, filters and immutable accounting verified.');
