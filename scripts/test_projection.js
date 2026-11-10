'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const context = vm.createContext({});
for (const file of ['consistency.js', 'workspace.js', 'projection.js', 'swing.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
}
const evaluate = code => vm.runInContext(code, context);
context.history = [
  { effectiveDate: '2025-07-01', risk: 20 },
  { effectiveDate: '2026-04-01', risk: 300 }
];
context.rows = [
  { id: 'a', symbol: 'A', date: '2025-07-08', opened: '2025-07-08T09:00:00-04:00', closed: '2025-07-08T09:01:00-04:00', pnl: 10 },
  { id: 'b', symbol: 'B', date: '2025-07-08', opened: '2025-07-08T09:02:00-04:00', closed: '2025-07-08T09:03:00-04:00', pnl: -6 },
  { id: 'c', symbol: 'C', date: '2025-07-09', opened: '2025-07-09T09:00:00-04:00', closed: '2025-07-09T09:01:00-04:00', pnl: 0 }
];
const snapshot = JSON.stringify({ rows: context.rows, history: context.history });
evaluate("globalThis.result = growthProjection(rows, history, '2026-11-06', 2, 'session', 10)");
const result = context.result;
assert.equal(result.initialRisk, 300);
assert.equal(result.endDate, '2027-11-06');
assert.equal(result.trades[0].date, '2026-11-09', 'First future session skips the weekend');
assert.equal(result.trades[0].pnl, 150, 'Projection scales historical PnL/R by current risk');
assert.equal(result.trades[1].pnl, -90, 'Negative outcomes keep their sign before absolute-value charts');
assert.equal(result.trades[2].pnl, 0, 'Zero trades remain in the projected sequence');
assert.equal(result.trades[3].date, '2026-11-11');
assert.equal(result.trades[3].projectedRisk, 330, 'Risk increases before session N+1');
assert.equal(result.trades[3].pnl, 165);
evaluate("globalThis.doubled = growthProjection(rows, history, '2026-11-06', 2, 'session', 10, 2)");
assert.deepEqual(Array.from(context.doubled.points, point => Array.from(point)), Array.from(result.points, point => Array.from(point)), 'Size does not change the configured risk');
assert.deepEqual(Array.from(context.doubled.trades, trade => trade.pnl), Array.from(result.trades, trade => trade.pnl * 2), 'Size scales positive, negative and zero PnL');
assert.equal(evaluate('sessionSwings(result.trades, history, true).sessions[0].maximum'), 150, 'Projected order preserves the within-session high');
assert.equal(evaluate('sessionSwings(result.trades, history, true).sessions[0].pnl'), 60);
context.swingRows = [-10, 4].map((pnl, index) => ({
  id: String(index), symbol: 'S', date: '2025-07-08', opened: `2025-07-08T09:0${index}:00-04:00`, closed: `2025-07-08T09:0${index}:30-04:00`, pnl
}));
evaluate('globalThis.historicalSwing = sessionSwings(swingRows, history)');
assert.equal(context.historicalSwing.sessions[0].minimum, -10);
assert.equal(context.historicalSwing.sessions[0].maximum, 0, 'Session range includes the starting zero');
assert.equal(context.historicalSwing.sessions[0].pnl, -6);
assert.equal(context.historicalSwing.maximumLossR, 0.5);
assert.equal(context.historicalSwing.reachedPercent, 0);
assert.equal(evaluate("sessionSwings(growthProjection(swingRows, history, '2026-11-06', 20, 'session', 0, 2).trades, history, true).reachedPercent"), 100, 'A size of two reaches the stop exactly');
assert.equal(evaluate("sessionSwings(growthProjection(swingRows, history, '2026-11-06', 20, 'session', 0, 3).trades, history, true).maximumLossR"), 1.5, 'Sessions are not truncated at the stop');
assert.equal(evaluate("sessionSwings([{...swingRows[0], date: '2025-06-01'}], history).excludedSessions"), 1, 'Unknown risk sessions are excluded');
assert.equal(evaluate("sessionSwings([{...swingRows[0], closed: 'invalid'}], history).excludedSessions"), 1, 'Invalid closure times cannot create partial session ranges');
assert.equal(evaluate("sessionSwings([], history).reachedPercent"), null, 'Empty history does not claim zero stop hits');
evaluate("globalThis.simultaneous = sessionSwings(swingRows.map(trade => ({...trade, closed: swingRows[0].closed})), history)");
assert.equal(context.simultaneous.sessions[0].minimum, -6, 'Simultaneous closes are aggregated without inventing intermediate paths');
evaluate(`globalThis.escapeSwing = text => String(text).replace(/[&<>\"]/g, '');`);
vm.runInContext("const esc = escapeSwing, num = (value, digits = 2) => value.toFixed(digits), money = value => '$' + value.toFixed(2), signed = money, usdMoney = money, usdSigned = money, chartLabel = value => value; function helpAttributes(value) { return 'data-help=\"' + esc(value) + '\"'; }", context);
for (const unit of ['r', 'usd']) {
  context.swingUnit = unit;
  const svg = evaluate("sessionSwingSvg(historicalSwing.sessions, {swingUnit, width: 500})");
  assert.ok(svg.includes('<circle') && svg.includes('stroke-dasharray="5 4"'), 'Range chart includes the final point and stop line');
  assert.ok(!/NaN|Infinity|undefined/.test(svg), 'Range chart has finite coordinates in both units');
}
context.denseSessions = Array.from({ length: 1500 }, (_, index) => ({ ...context.historicalSwing.sessions[0], date: String(index) }));
const denseSwing = evaluate('sessionSwingSvg(denseSessions,{width:320,height:300})');
const swingGroups = [...denseSwing.matchAll(/<g [\s\S]*?<\/g>/g)];
assert.equal(swingGroups.length, 1500, 'Fitting the chart must preserve every session');
let previousHitEnd = 88;
for (const [group] of swingGroups) {
  const rects = [...group.matchAll(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)"/g)];
  const barWidth = Number(rects[0][3]), hitX = Number(rects[1][1]), hitWidth = Number(rects[1][3]);
  assert.ok(barWidth > 0 && barWidth < hitWidth, 'Dense session bars must fit their own column');
  assert.ok(Math.abs(hitX - previousHitEnd) < 1e-8, 'Dense hit areas must cover adjacent sessions without overlap');
  previousHitEnd = hitX + hitWidth;
}
assert.ok(Math.abs(previousHitEnd - 298) < 1e-8, 'Every session must stay inside the available plot width');
assert.ok(result.trades.every(trade => ![0, 6].includes(new Date(trade.date).getUTCDay())));
assert.ok(result.trades.every(trade => trade.date > '2026-11-06' && trade.date <= '2027-11-06'));
assert.equal(evaluate("growthProjection(rows, history, '2026-11-06', 1, 'session', 0).finalRisk"), 300);
assert.equal(evaluate("growthProjection(rows, history, '2026-11-06', 1, 'day', 10).points[1][0]"), '2026-11-07');
assert.equal(evaluate("growthProjection(rows, history, '2026-11-06', 1, 'week', 10).points[1][0]"), '2026-11-13');
assert.equal(evaluate("growthProjection(rows, history, '2026-11-06', 1, 'month', 10).points[1][0]"), '2026-12-06');
assert.equal(evaluate("projectionMonth('2027-01-31', 1)"), '2027-02-28');
assert.equal(evaluate("projectionMonth('2028-01-31', 1)"), '2028-02-29');
assert.equal(evaluate("growthProjection([], history, '2026-11-06', 20, 'session', 10).trades.length"), 0);
assert.equal(evaluate("growthProjection([{...rows[0], opened: '2025-06-01T09:00:00-04:00'}], history, '2026-11-06', 20, 'session', 10).excluded"), 1);
for (const expression of [
  "growthProjection(rows, history, '2026-11-06', 0, 'session', 10)",
  "growthProjection(rows, history, '2026-11-06', 1.5, 'session', 10)",
  "growthProjection(rows, history, '2026-11-06', 20, 'session', NaN)",
  "growthProjection(rows, history, '2026-11-06', 20, 'session', -10)",
  "growthProjection(rows, history, '2026-11-06', 20, 'session', 10, 0)",
  "growthProjection(rows, history, '2026-11-06', 20, 'session', 10, NaN)",
  "growthProjection(rows, [], '2026-11-06', 20, 'session', 10)",
  "growthProjection(rows, history, '2026-11-06', 1, 'day', 1000)"
]) assert.throws(() => evaluate(expression));
assert.equal(JSON.stringify({ rows: context.rows, history: context.history }), snapshot, 'Projection preserves real trades and risk history');
console.log('Projection: compounding, cadence units, risk normalization, zeros, calendar boundaries and immutable sources verified.');
