'use strict';

function runPnlUnitChecks(check, evaluate) {
  evaluate(`
    sessionRiskHistory = [
      { effectiveDate: '2025-01-01', risk: 20 },
      { effectiveDate: '2025-09-01', risk: 50 },
      { effectiveDate: '2026-04-01', risk: 300 }
    ];
    globalThis.unitTrades = [
      { id: 'early', date: '2025-08-31', opened: '2025-08-31T23:30:00-04:00', closed: '2025-08-31T23:40:00-04:00', symbol: 'A', side: 'BUY', pnl: 20, fees: 1, entryPrice: 5, entryQty: 4, holdMinutes: 10 },
      { id: 'later', date: '2025-09-01', opened: '2025-09-01T09:00:00-04:00', closed: '2025-09-01T09:10:00-04:00', symbol: 'A', side: 'BUY', pnl: -25, fees: 2, entryPrice: 10, entryQty: 5, holdMinutes: 10 },
      { id: 'current', date: '2026-04-01', opened: '2026-04-01T09:00:00-04:00', closed: '2026-04-01T09:10:00-04:00', symbol: 'B', side: 'SELL', pnl: 300, fees: 3, entryPrice: 20, entryQty: 15, holdMinutes: 10 }
    ];
    globalThis.unitSnapshot = JSON.stringify(unitTrades);
    globalThis.rTrades = displayPnlRows(unitTrades, 'r');
    pnlDisplayUnit = 'r';
  `);
  check(evaluate('sum(rTrades)') === 1.5, 'Mixed historical risk values normalize each trade before summing');
  check(evaluate('sum(unitTrades) / 300') !== 1.5, 'The total is never divided by current risk');
  check(evaluate('statistics(rTrades).expectancy') === 0.5, 'Average PnL uses normalized per-trade R');
  check(evaluate("money(sum(rTrades))") === '1.50 R', 'R totals display R units');
  check(evaluate("usdMoney(rTrades[0].entryPrice)") === '$5.00', 'Entry prices remain USD');
  check(evaluate("usdMoney(statistics(rTrades).fees)") === '$6.00', 'Fees remain USD and are not subtracted again');
  check(evaluate("JSON.stringify(displayPnlRows(rTrades, 'usd').map(trade => trade.pnl))") === '[20,-25,300]', 'Switching back restores original dollars');
  check(evaluate('sum(displayPnlRows(rTrades, "r"))') === 1.5, 'Repeated display conversion cannot divide twice');
  check(evaluate('JSON.stringify(unitTrades) === unitSnapshot'), 'Source accounting is immutable');
  check(evaluate("displayPnlRows([{ ...unitTrades[0], opened: '2025-09-01T03:30:00Z', date: '2025-09-01' }], 'r')[0].pnl") === 1, 'Risk date follows entry in New York, not UTC or closing date');
  check(evaluate("displayPnlRows([{ ...unitTrades[0], opened: '2025-08-31T23:30:00-04:00', date: '2025-09-02' }], 'r')[0].pnl") === 1, 'A trade crossing a risk change retains entry risk');
  check(evaluate("displayPnlRows([{ ...unitTrades[0], opened: '2024-12-31T09:00:00-05:00' }], 'r').length") === 0, 'Unknown risk is excluded, never invented');
  check(evaluate("displayPnlRows([{ ...unitTrades[0], opened: '2025-06-01T09:00:00-04:00' }], 'r')[0].pnl") === 1, 'The user-confirmed 20 USD baseline applies before July');
  check(evaluate("calendarWeekSummaries('2025-09', rTrades)[0].pnl") === -0.5, 'Weekly calendar totals use R before grouping');
  check(evaluate("calendarWeekSummaries('2025-08', rTrades).at(-1).pnl") === 1, 'Calendar boundary weeks retain the correct historical R');
  check(evaluate('optimalSample(unitTrades, sessionRiskHistory).expectancy === optimalSample(rTrades, sessionRiskHistory).expectancy'), 'Optimal sizing does not normalize R display rows twice');
  check(evaluate("growthProjection(unitTrades, sessionRiskHistory, '2026-11-10', 20, 'session', 10).trades[0].pnl === growthProjection(rTrades, sessionRiskHistory, '2026-11-10', 20, 'session', 10).trades[0].pnl"), 'Projection uses original historical USD regardless of display mode');
  check(evaluate('JSON.stringify(sessionSwings(unitTrades, sessionRiskHistory)) === JSON.stringify(sessionSwings(rTrades, sessionRiskHistory))'), 'Session risk and stop calculations do not divide converted PnL again');
  check(evaluate("displayPnlRows([{ ...unitTrades[2], projectedRisk: 600, pnl: 1200 }], 'r')[0].pnl") === 2, 'Projected PnL uses its projected risk rather than historical risk');
  evaluate(`
    globalThis.meanProjection = growthProjection(unitTrades, sessionRiskHistory, '2026-11-10', 2, 'session', 10, 2);
    globalThis.meanProjectionR = growthProjection(rTrades, sessionRiskHistory, '2026-11-10', 2, 'session', 10, 2);
    globalThis.meanProjectionRows = meanProjection.trades.map(trade => ({ ...trade, pnl: trade.averagePnl }));
  `);
  check(evaluate('meanProjection.meanAbsoluteR === meanProjectionR.meanAbsoluteR'), 'The filtered mean is identical when source rows are displayed in USD or R');
  check(evaluate('JSON.stringify(meanProjection.trades.map(trade => trade.averagePnl)) === JSON.stringify(meanProjectionR.trades.map(trade => trade.averagePnl))'), 'Projection of the mean always uses canonical USD');
  check(evaluate("displayPnlRows(meanProjectionRows, 'r').every(trade => Math.abs(trade.pnl - 5 / 3) < 1e-12)"), 'The mean chart is flat in R, including the size multiplier');
  check(evaluate("displayPnlRows(meanProjectionRows, 'usd')[0].pnl === 500 && displayPnlRows(meanProjectionRows, 'usd')[3].pnl === 550"), 'The mean chart grows in dollars as projected risk increases');
  check(evaluate("['day', 'week', 'month'].every(unit => growthPeriods(displayPnlRows(meanProjectionRows, 'r'), unit).every(period => Math.abs(period.meanAbsolutePnl - 5 / 3) < 1e-12))"), 'All grouping periods preserve the constant mean in R');
  check(evaluate("growthTradePoints(displayPnlRows(meanProjectionRows, 'r'), '50').length === 50 && meanProjection.sourceTrades === 3"), 'The visible trade limit does not change the source sample');
  check(evaluate("svgChart([{ values: [['a', 1], ['b', 2]] }], { currency: true }).includes(' R')"), 'PnL chart axes use R');
  check(evaluate("svgChart([{ values: [['a', 20], ['b', 300]] }], { currency: true, currencyUnit: 'usd' }).includes('$')"), 'Risk-value chart axes remain USD');
  check(evaluate("durationScatterSvg([{ values: [[5, 1]] }], { currency: true, xCurrency: true }).includes('$')"), 'Price scatter axes remain USD while PnL uses R');
  check(evaluate("tableSortValue('10.25 R', 'PnL')") === 10.25, 'R tables sort numerically');
  evaluate("pnlDisplayUnit = 'usd'");
  check(evaluate('money(1.5)') === '$1.50', 'USD formatting is restored');
}

if (typeof require !== 'undefined') {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const assert = require('node:assert/strict');
  const root = path.join(__dirname, '..');
  const context = vm.createContext({ Intl });
  vm.runInContext(fs.readFileSync(path.join(root, 'dashboard.js'), 'utf8').split("$('search').addEventListener")[0], context);
  for (const file of ['workspace.js', 'calendar.js', 'consistency.js', 'duration.js', 'projection.js', 'optimal.js', 'swing.js', 'table-sort.js', 'help.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  }
  runPnlUnitChecks((condition, message) => assert.ok(condition, message), code => vm.runInContext(code, context));
  console.log('Historical R conversion, aggregates, models, units and immutable USD accounting verified.');
}
