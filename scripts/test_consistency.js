'use strict';

if (typeof require !== 'undefined') {
  const fs = require('fs');
  const vm = require('vm');
  const path = require('path');
  vm.runInThisContext(`
    const EPSILON = 0.000001;
    const sum = rows => rows.reduce((total, trade) => total + trade.pnl, 0);
    const mean = values => values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
    let dataset = null;
    function classify(trade) { return trade.pnl > EPSILON ? 'win' : trade.pnl < -EPSILON ? 'loss' : 'scratch'; }
  `);
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'consistency.js'), 'utf8'));
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'workspace.js'), 'utf8'));
}

function checkConsistency(condition, message) {
  if (!condition) throw new Error(message);
}

function consistencyFixture(pnl, index, day = '2026-11-02') {
  return { pnl, date: day, opened: `${day}T09:${String(index).padStart(2, '0')}:00-05:00`,
    closed: `${day}T09:${String(index).padStart(2, '0')}:30-05:00`, entryQty: 10 };
}

const recoveryFixture = [10, -4, -3, 7, -2].map((pnl, index) => consistencyFixture(pnl, index));
const recoveryResult = recoveryEpisodes(recoveryFixture);
checkConsistency(recoveryResult.length === 2, 'Recovered and open drawdowns stay separate');
checkConsistency(recoveryResult[0].trough === 7 && recoveryResult[0].trades === 3 && recoveryResult[0].recovered, 'Recovery includes the trade that regains the peak');
checkConsistency(recoveryResult[1].trades === 1 && !recoveryResult[1].recovered, 'Open episode stays censored');
checkConsistency(recoveryResult.every(episode => episode.days === 0), 'Same-day recovery takes zero calendar days');
checkConsistency(recoveryEpisodes([]).length === 0 && recoveryEpisodes([consistencyFixture(10, 0)]).length === 0, 'No invented empty or positive-only episodes');
const initialLoss = recoveryEpisodes([-5, 5].map((pnl, index) => consistencyFixture(pnl, index)));
checkConsistency(initialLoss[0].trades === 2 && initialLoss[0].recovered, 'Initial loss is measured from the zero baseline');

const rollingFixture = [1, -2, 3, 4].map((pnl, index) => consistencyFixture(pnl, index));
const rollingResult = rollingConsistency(rollingFixture.slice().reverse(), 3);
checkConsistency(rollingResult.length === 2 && rollingResult[0].pnl === 2 && rollingResult[1].pnl === 5, 'Rolling windows use chronological full samples');
checkConsistency(rollingConsistency(rollingFixture, 5).length === 0, 'Incomplete windows are omitted');
checkConsistency(rollingResult[0].pf === 2 && Math.abs(rollingResult[0].winRate - 200 / 3) < 1e-9, 'Rolling profit factor and win rate match known values');
checkConsistency(consistencyPeriod('2027-01-03', 'week') === '2026-12-28', 'Monday weeks span year boundaries');
checkConsistency(consistencyPeriod('2026-11-01', 'month') === '2026-11', 'Month grouping uses NY date');
checkConsistency(periodConsistency(rollingFixture, 'month')[0].average === 1.5, 'Monthly expectancy uses trade counts');
checkConsistency(sampleQuantile([0, 10], 0.5) === 5 && sampleQuantile([], 0.5) === null, 'Percentiles interpolate and handle empty input');

const overlapping = [
  { ...consistencyFixture(-10, 0), closed: '2026-11-02T10:00:00-05:00' },
  { ...consistencyFixture(5, 1), opened: '2026-11-02T09:30:00-05:00', closed: '2026-11-02T09:40:00-05:00' },
  { ...consistencyFixture(-3, 2), opened: '2026-11-02T10:01:00-05:00', closed: '2026-11-02T10:02:00-05:00' }
];
const behaviorResult = postOutcomeGroups(overlapping);
checkConsistency(behaviorResult.none.length === 2 && behaviorResult.loss.length === 1, 'Open positions do not leak future results into post-loss groups');
checkConsistency(behaviorResult.loss[0].waitMinutes === 1, 'Post-loss wait is measured from the last known close');

const snapshot = JSON.stringify(recoveryFixture);
const deterministic = resampleConsistency([consistencyFixture(2, 0)], 25, 20);
checkConsistency(deterministic.finals.every(value => value === 50), 'Constant positive source yields exact terminal PnL');
checkConsistency(deterministic.drawdowns.every(value => value === 0), 'Constant gains do not produce drawdown');
const negative = resampleConsistency([consistencyFixture(-2, 0)], 25, 20);
checkConsistency(negative.finals.every(value => value === -50) && negative.losingStreaks.every(value => value === 25), 'Constant losses preserve expected losses and streaks');
const block = resampleConsistency([consistencyFixture(10, 0), consistencyFixture(-5, 1)], 3, 20);
checkConsistency(block.finals.every(value => value === 15) && block.drawdowns.every(value => value === 5), 'Session blocks preserve internal order and truncate at the horizon');
checkConsistency(JSON.stringify(resampleConsistency(recoveryFixture, 25, 20)) === JSON.stringify(resampleConsistency(recoveryFixture, 25, 20)), 'Fixed history produces repeatable simulations');
checkConsistency(resampleConsistency([], 25) === null && JSON.stringify(recoveryFixture) === snapshot, 'Empty simulation stays empty and source data is immutable');
const growthPnlFixture = [
  { date: '2026-01-02', pnl: 10, entryQty: 1, entryPrice: 1000 },
  { date: '2026-01-03', pnl: -6, entryQty: null, entryPrice: null },
  { date: '2026-01-04', pnl: 0, entryQty: 10000, entryPrice: 0.1 },
  { date: '2026-02-02', pnl: 20 }
];
const growthPnlResult = growthPeriods(growthPnlFixture);
checkConsistency(growthPnlResult[0].pnl === 4 && growthPnlResult[1].cumulative === 24, 'Growth reconciles monthly and accumulated PnL');
checkConsistency(growthPnlResult[0].meanAbsolutePnl === 16 / 3 && growthPnlResult[0].medianAbsolutePnl === 6, 'Absolute PnL is computed per trade before aggregation, including zero trades');
checkConsistency(growthPnlResult[0].average === 4 / 3, 'Signed mean stays separate from mean magnitude');
checkConsistency(JSON.stringify(growthPeriods(growthPnlFixture.map(({ date, pnl }) => ({ date, pnl })))) === JSON.stringify(growthPnlResult), 'Growth does not depend on share quantity or price');
checkConsistency(growthPeriods([]).length === 0, 'Empty growth history stays empty');
const savedCountryDataset = dataset;
const legalProfile = { incorporation_country: 'Canada', incorporation_jurisdiction: '', operating_country: '', vie_status: 'unknown' };
dataset = { tickerProfiles: { LEGAL: legalProfile, OPSONLY: { operating_country: 'United States' } } };
checkConsistency(tradeCountry({ symbol: 'LEGAL', country: 'China' }) === 'Canada', 'Country studies use incorporation despite conflicting operating country');
checkConsistency(tradeCountry({ symbol: 'OPSONLY', country: 'United States' }) === '', 'Operating country cannot replace missing incorporation');
const legalAudit = auditIssuerData({ trades: [{ symbol: 'LEGAL', date: '2026-11-05' }, { symbol: 'OPSONLY', date: '2026-11-05' }, { symbol: 'NEW', date: '2026-11-05' }], tickerProfiles: dataset.tickerProfiles });
checkConsistency(!legalAudit.find(row => row.symbol === 'LEGAL').country, 'Missing jurisdiction and VIE do not make a known country unidentified');
checkConsistency(legalAudit.filter(row => row.country).length === 2, 'Only missing incorporation countries count as unidentified');
checkConsistency(incorporationCountry({ incorporation_country: 'unknown' }) === '' && incorporationCountry({ incorporation_country: 123 }) === '', 'Placeholder or invalid countries remain unidentified');
dataset = savedCountryDataset;
console.log('Consistency calculations passed: rolling windows, periods, recovery, causal ordering, percentiles, session resampling and immutability.');
