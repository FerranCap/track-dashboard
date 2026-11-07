'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const context = vm.createContext({});
for (const file of ['consistency.js', 'workspace.js', 'projection.js']) {
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
  "growthProjection(rows, [], '2026-11-06', 20, 'session', 10)",
  "growthProjection(rows, history, '2026-11-06', 1, 'day', 1000)"
]) assert.throws(() => evaluate(expression));
assert.equal(JSON.stringify({ rows: context.rows, history: context.history }), snapshot, 'Projection preserves real trades and risk history');
console.log('Projection: compounding, cadence units, risk normalization, zeros, calendar boundaries and immutable sources verified.');
