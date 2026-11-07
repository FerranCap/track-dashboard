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
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'calendar.js'), 'utf8'));
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
checkConsistency(consistencyPeriod('2026-11-01', 'day') === '2026-11-01', 'Daily grouping preserves the NY closing date');
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
const individualPnlFixture = [10, -6, 0].map((pnl, index) => ({ ...consistencyFixture(pnl, index), symbol: 'TEST', id: String(index) }));
const individualPnlPoints = growthTradePoints(individualPnlFixture.slice().reverse(), 'all');
checkConsistency(individualPnlPoints.map(point => point.absolute).join(',') === '10,6,0', 'Individual PnL chart keeps absolute values and zero trades instead of monthly averages');
checkConsistency(individualPnlPoints[1].trade.pnl === -6 && individualPnlPoints[1].number === 2, 'Original signed PnL and chronological ordinal remain available');
const longPnlFixture = Array.from({ length: 60 }, (_, index) => ({ pnl: index, closed: new Date(Date.UTC(2026, 10, 5, 9, index)).toISOString() }));
const lastFifty = growthTradePoints(longPnlFixture, '50');
checkConsistency(lastFifty.length === 50 && lastFifty[0].number === 11 && lastFifty.at(-1).absolute === 59, 'Chart window uses the last trades without losing global filtered order');
checkConsistency(growthTradePoints([], 'all').length === 0, 'Empty individual PnL chart stays empty');
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
checkConsistency(shiftCalendarMonth('2026-01', -1) === '2025-12' && shiftCalendarMonth('2026-12', 1) === '2027-01', 'Calendar navigation crosses year boundaries');
const leapCells = miniCalendarCells('2024-02');
checkConsistency(leapCells.length === 42 && leapCells.filter(cell => !cell.outside).length === 29, 'Mini calendars preserve leap days in a fixed six-week grid');
checkConsistency(leapCells[0].date === '2024-01-29' && leapCells[3].date === '2024-02-01', 'Mini calendars start weeks on Monday');
checkConsistency(miniCalendarCells('2026-11').filter(cell => !cell.outside).length === 30, 'Mini calendar marks adjacent-month padding separately');
// Exercise ticker cards with the production calculations and a minimal render target.
const calendarFs = require('node:fs'), calendarVm = require('node:vm'), calendarPath = require('node:path');
const calendarElements = new Map();
const calendarContext = calendarVm.createContext({ URL, document: { getElementById(id) {
  if (!calendarElements.has(id)) calendarElements.set(id, { innerHTML: '', textContent: '', hidden: false });
  return calendarElements.get(id);
} } });
const dashboardSource = calendarFs.readFileSync(calendarPath.join(__dirname, '..', 'dashboard.js'), 'utf8');
calendarVm.runInContext(dashboardSource.slice(0, dashboardSource.indexOf("$('search').addEventListener")), calendarContext);
for (const file of ['news.js', 'workspace.js', 'help.js', 'consistency.js', 'calendar.js']) calendarVm.runInContext(calendarFs.readFileSync(calendarPath.join(__dirname, '..', file), 'utf8'), calendarContext);
calendarVm.runInContext('const renderedCalendarCharts = new Map(); renderChart = (id, series) => renderedCalendarCharts.set(id, series);', calendarContext);
calendarContext.riskFixture = JSON.parse(calendarFs.readFileSync(calendarPath.join(__dirname, '..', 'data', 'session-risk.json'), 'utf8'));
checkConsistency(calendarVm.runInContext("sessionRiskAt('2025-06-30', riskFixture)", calendarContext) === null, 'Risk is unknown before its first activation');
checkConsistency(calendarVm.runInContext("sessionRiskAt('2025-08-31', riskFixture).risk", calendarContext) === 20, 'Risk remains active until the next change');
checkConsistency(calendarVm.runInContext("sessionRiskAt('2025-09-01', riskFixture).risk", calendarContext) === 50, 'New risk applies on its activation date');
checkConsistency(calendarVm.runInContext("sessionRiskAt('2026-11-07', riskFixture).risk", calendarContext) === 300, 'Last risk stays active without an end date');
checkConsistency(calendarVm.runInContext("sessionRiskPoints(riskFixture, '2025-06-30').length", calendarContext) === 0, 'Risk chart does not backfill unknown dates');
checkConsistency(calendarVm.runInContext("JSON.stringify(sessionRiskPoints(riskFixture, '2025-08-01'))", calendarContext) === JSON.stringify([['2025-07-01', 20], ['2025-08-01', 20]]), 'Risk chart extends the active level and excludes future changes');
const riskSvg = calendarVm.runInContext("svgChart([{values: sessionRiskPoints(riskFixture, '2026-11-07')}], {step: true, timeAxis: true, currency: true})", calendarContext);
checkConsistency(/H[\d.]+ V[\d.]+/.test(riskSvg) && !/NaN|Infinity|undefined/.test(riskSvg), 'Risk chart renders discrete steps on the time axis');
calendarContext.sampleRows = [10, -2, 5].map((pnl, index) => ({ id: String(index), symbol: 'MIX', side: index === 2 ? 'SELL' : 'BUY', pnl, fees: 0.1 * (index + 1), date: '2026-11-06', opened: `2026-11-06T09:0${index}:00-05:00`, closed: `2026-11-06T09:1${index}:00-05:00` }));
calendarVm.runInContext('renderCalendarDay(sampleRows)', calendarContext);
let tickerMarkup = calendarElements.get('calendar-symbol-cards').innerHTML;
checkConsistency((tickerMarkup.match(/class="calendar-ticker-side"/g) || []).length === 2, 'Mixed tickers show separate Long and Short metric groups');
checkConsistency(tickerMarkup.includes('50.0%') && tickerMarkup.includes('100.0%'), 'Win rates use each direction denominator');
checkConsistency(tickerMarkup.includes('+$8.00') && tickerMarkup.includes('+$5.00'), 'PnL is calculated separately by direction');
checkConsistency(calendarVm.runInContext("renderedCalendarCharts.get('calendar-ticker-chart-0')[0].values.at(-1)[1]", calendarContext) === 13, 'Ticker chart combines Long and Short trades');
for (const side of ['BUY', 'SELL']) {
  calendarContext.selectedSide = side;
  calendarVm.runInContext('renderCalendarDay(sampleRows.filter(trade => trade.side === selectedSide))', calendarContext);
  tickerMarkup = calendarElements.get('calendar-symbol-cards').innerHTML;
  checkConsistency((tickerMarkup.match(/class="calendar-ticker-side"/g) || []).length === 1 && tickerMarkup.includes('single-side'), 'Direction filtering removes the other metric group');
  checkConsistency(!tickerMarkup.includes(`aria-label="MIX ${side === 'BUY' ? 'Short' : 'Long'}"`), 'Single-direction ticker cards have no empty opposite-side section');
}
calendarVm.runInContext('renderCalendarDay([])', calendarContext);
checkConsistency(calendarElements.get('calendar-symbol-cards').innerHTML === '', 'Empty filtered sessions clear ticker detail');
calendarVm.runInContext(calendarFs.readFileSync(calendarPath.join(__dirname, '..', 'filters.js'), 'utf8'), calendarContext);
const comparisonHeaders = Array.from({ length: 7 }, () => ({ style: {} }));
const comparisonRows = Array.from({ length: 8 }, () => {
  const cells = Array.from({ length: 7 }, () => {
    const classes = new Set();
    return { classes, classList: { remove(...values) { values.forEach(value => classes.delete(value)); }, add(value) { classes.add(value); } } };
  });
  return { cells, querySelectorAll: () => cells };
});
calendarElements.set('compare-table', { innerHTML: '', querySelectorAll: selector => selector === 'thead th' ? comparisonHeaders : comparisonRows });
calendarVm.runInContext(`
  dataset = { trades: sampleRows };
  const comparisonSamples = [sampleRows.slice(0, 2), sampleRows.slice(2), sampleRows, [], [sampleRows[1]], [sampleRows[0]]];
  for (const [index, key] of ['a', 'b', 'c', 'd', 'e', 'f'].entries()) {
    comparisonGroups.set(key, { key, name: 'Grupo ' + key.toUpperCase(), color: COMPARISON_COLORS[index].value });
    tradeFilterPanels.set(key, { matchingRows: () => comparisonSamples[index] });
  }
  renderComparisons();
`, calendarContext);
const comparisonSeries = calendarVm.runInContext("renderedCalendarCharts.get('compare-chart')", calendarContext);
checkConsistency(comparisonSeries.length === 6, 'The comparison chart supports six groups including an empty group');
checkConsistency(comparisonSeries.map(series => series.values.at(-1)[1]).join(',') === '8,5,13,0,-2,10', 'Each curve uses its own trades on the shared date axis');
checkConsistency(comparisonSeries.every((series, index) => series.color === comparisonHeaders[index + 1].style.color), 'Chart colors and table group headings stay synchronized');
checkConsistency(comparisonRows[1].cells[1].classes.has('positive') && comparisonRows[1].cells[5].classes.has('negative'), 'PnL retains profit and loss colors independently of group identity');
checkConsistency(comparisonRows.filter((_, index) => index !== 1).every(row => row.cells.every(cell => cell.classes.size === 0)), 'Other metric values retain neutral text');
checkConsistency(calendarElements.get('compare-legend').innerHTML.includes('Grupo F'), 'The legend includes additional groups');
comparisonHeaders.pop(); comparisonRows.forEach(row => row.cells.pop());
calendarVm.runInContext("comparisonGroups.delete('f'); tradeFilterPanels.delete('f'); renderComparisons();", calendarContext);
checkConsistency(calendarVm.runInContext("renderedCalendarCharts.get('compare-chart').length", calendarContext) === 5 && !calendarElements.get('compare-legend').innerHTML.includes('Grupo F'), 'Removing a group removes its curve, table column and legend entry');
calendarElements.set('data-pending-search', { value: '' });
calendarElements.set('data-pending-kind', { value: 'country' });
calendarVm.runInContext(`
  issuerAudit = auditIssuerData({ trades: [{ symbol: 'KNOWN', date: '2026-11-06' }], tickerProfiles: { KNOWN: { incorporation_country: 'Canada' } } });
  renderPendingIssuers();
`, calendarContext);
checkConsistency(calendarElements.get('data-pending-panel').hidden && !calendarElements.get('data-audit-complete').hidden, 'Fully identified incorporation countries hide the pending panel and show the completion badge even with other fields unknown');
calendarElements.get('data-pending-search').value = 'NO_MATCH';
calendarVm.runInContext(`
  issuerAudit = auditIssuerData({ trades: [{ symbol: 'UNKNOWN', date: '2026-11-06' }], tickerProfiles: {} });
  renderPendingIssuers();
`, calendarContext);
checkConsistency(!calendarElements.get('data-pending-panel').hidden && calendarElements.get('data-audit-complete').hidden, 'Unidentified tickers restore the panel even when the search has no matches');
calendarVm.runInContext('issuerAudit = []; renderPendingIssuers();', calendarContext);
checkConsistency(calendarElements.get('data-pending-panel').hidden && calendarElements.get('data-audit-complete').hidden, 'Empty history does not claim complete identification');
calendarContext.realNewsDataset = JSON.parse(calendarFs.readFileSync(calendarPath.join(__dirname, '..', 'data', 'trades.json'), 'utf8'));
calendarContext.realNewsPayload = JSON.parse(calendarFs.readFileSync(calendarPath.join(__dirname, '..', 'data', 'news', 'trade-context.json'), 'utf8'));
calendarElements.set('issuer-search', { value: 'VIVK' });
calendarVm.runInContext('dataset = realNewsDataset; updateIssuerNews(realNewsPayload, dataset); renderIssuerProfiles(dataset.trades);', calendarContext);
const issuerMarkup = calendarElements.get('issuer-table').innerHTML;
checkConsistency(issuerMarkup.includes('>Noticias<') && !issuerMarkup.includes('>VIE<'), 'Issuer table replaces VIE with the News column');
checkConsistency(issuerMarkup.includes('9 noticias') && issuerMarkup.includes('7 temas'), 'News counts deduplicate publications across linked trades');
checkConsistency(issuerMarkup.includes('<summary>Detalle</summary>') && issuerMarkup.includes('news-linked-trades') && issuerMarkup.includes('https://finviz.com/news/'), 'Expanded news includes publication details, source links and matched entries');
checkConsistency(issuerMarkup.includes('Incluida por fecha') && !issuerMarkup.includes('publicaciones pendientes') && issuerMarkup.includes('7 de 7 operaciones revisadas'), 'Date-only candidates use the explicit fallback without invented hours');
const labtNewsMarkup = calendarVm.runInContext("issuerNewsCell(dataset.tickerProfiles.LABT)", calendarContext);
checkConsistency(labtNewsMarkup.includes('2 noticias') && labtNewsMarkup.includes('8 de 8 operaciones revisadas'), 'LABT publications are deduplicated and all exact entries retain their reviews');
checkConsistency(calendarVm.runInContext("issuerNewsCell(dataset.tickerProfiles.PLCE)", calendarContext).includes('2 noticias'), 'PLCE distinguishes the leadership filing and separately published bankruptcy report');
const dkiNewsMarkup = calendarVm.runInContext("issuerNewsCell(dataset.tickerProfiles.DKI)", calendarContext);
checkConsistency(dkiNewsMarkup.includes('2 noticias') && dkiNewsMarkup.includes('Coincidencia del mismo día') && !dkiNewsMarkup.includes('04:34'), 'DKI report counts by date with no unconfirmed clock displayed and an explicit ordering limitation');
const vcigNewsMarkup = calendarVm.runInContext("issuerNewsCell(dataset.tickerProfiles.VCIG)", calendarContext);
checkConsistency(vcigNewsMarkup.includes('1 noticia') && vcigNewsMarkup.includes('Limitaciones de la fuente') && !vcigNewsMarkup.includes('publicación pendiente'), 'VCIG publication counts with source discrepancies visible');
calendarVm.runInContext('globalThis.newsAudit = auditNewsCoverage(dataset); renderNewsCoverage()', calendarContext);
checkConsistency(calendarContext.newsAudit.length === 500 && calendarContext.newsAudit.reduce((total, entry) => total + entry.reviewed, 0) === 634, 'News audit checks every ticker and exact reviewed entry, independently of analysis filters');
checkConsistency(calendarContext.newsAudit.reduce((total, entry) => total + entry.pending, 0) === 926, 'News audit preserves all unreviewed entries');
checkConsistency(calendarContext.newsAudit.filter(entry => entry.reviewed === 0 && !entry.articles).every(entry => entry.articles === null), 'Unresearched tickers show unknown news counts rather than zero publications');
checkConsistency(calendarContext.newsAudit.find(entry => entry.symbol === 'LABT').pending === 0 && calendarContext.newsAudit.find(entry => entry.symbol === 'LABT').complete, 'LABT coverage includes every exact entry in the reviewed sources');
checkConsistency(calendarElements.get('data-news-complete').hidden, 'Partial news history cannot show the completion badge');
calendarElements.set('data-news-search', { value: 'NO_MATCH' });
calendarVm.runInContext('renderNewsCoverage()', calendarContext);
checkConsistency(calendarElements.get('data-news-table').innerHTML.includes('No hay tickers') && calendarElements.get('data-news-complete').hidden, 'An empty news search does not imply completion');
calendarElements.set('data-news-search', { value: '' });
calendarVm.runInContext("dataset = { ...realNewsDataset, trades: realNewsDataset.trades.filter(trade => trade.symbol === 'VIVK') }; updateIssuerNews(realNewsPayload, dataset); renderNewsCoverage()", calendarContext);
checkConsistency(!calendarElements.get('data-news-complete').hidden && calendarElements.get('data-news-pending').hidden && calendarElements.get('data-news-progress').value === 100, 'All exact entries reviewed with no unresolved candidates show 100 percent and hide the pending list');
calendarVm.runInContext("dataset = { ...dataset, trades: [...dataset.trades, { ...dataset.trades[0], id: 'new-entry' }] }; renderNewsCoverage()", calendarContext);
checkConsistency(calendarElements.get('data-news-complete').hidden && !calendarElements.get('data-news-pending').hidden, 'A new trade revokes ticker news completion');
calendarVm.runInContext("dataset = { ...realNewsDataset, trades: realNewsDataset.trades.filter(trade => trade.symbol === 'WFF' && trade.date === '2026-11-03') }; updateIssuerNews(realNewsPayload, dataset); renderNewsCoverage()", calendarContext);
checkConsistency(!calendarElements.get('data-news-complete').hidden, 'A reviewed entry without a confirmed publication counts as reviewed rather than needing invented news');
calendarVm.runInContext(`dataset = { ...realNewsDataset, trades: realNewsDataset.trades.filter(trade => trade.symbol === 'DKI' && trade.date === '2026-11-04') };
  const pendingAuditPayload = JSON.parse(JSON.stringify(realNewsPayload));
  pendingAuditPayload.reviews.find(review => review.symbol === 'DKI').unresolvedCandidates = [{id: 'unidentified-date', candidateTradeIds: [dataset.trades[0].id]}];
  pendingAuditPayload.trades.find(trade => trade.tradeId === dataset.trades[0].id).unresolvedCandidateIds = ['unidentified-date'];
  updateIssuerNews(pendingAuditPayload, dataset); renderNewsCoverage()`, calendarContext);
checkConsistency(calendarElements.get('data-news-complete').hidden && calendarElements.get('data-news-table').innerHTML.includes('Verificación pendiente'), 'An unresolved publication blocks 100 percent even when every entry has a review');
calendarVm.runInContext("dataset = { ...realNewsDataset, trades: realNewsDataset.trades.filter(trade => trade.symbol === 'VIVK').map((trade, index) => index ? trade : {...trade, opened: '2026-07-24T10:27:30-04:00'}) }; renderNewsCoverage()", calendarContext);
checkConsistency(calendarElements.get('data-news-complete').hidden, 'Changed entry times invalidate audit completion even before a news reload');
calendarVm.runInContext('dataset = realNewsDataset; updateIssuerNews(null, dataset); renderNewsCoverage()', calendarContext);
checkConsistency(calendarElements.get('data-news-complete').hidden && calendarElements.get('data-news-table').innerHTML.includes('no disponible'), 'Unavailable news must not claim verified coverage');
calendarVm.runInContext('dataset = {...realNewsDataset, trades: []}; updateIssuerNews(realNewsPayload, dataset); renderNewsCoverage()', calendarContext);
checkConsistency(calendarElements.get('data-news-complete').hidden && calendarElements.get('data-news-progress').value === 0, 'Empty history does not claim 100 percent news coverage');
calendarVm.runInContext('dataset = realNewsDataset; updateIssuerNews(realNewsPayload, dataset)', calendarContext);
checkConsistency(calendarVm.runInContext("issuerNewsIndex.get('VIVK').articles.get('vivk-20261104-direct-midstream-wells-release').linkedTrades.size", calendarContext) === 1, 'A known timestamp outside 48 hours cannot use the date fallback');
checkConsistency(calendarVm.runInContext("issuerNewsIndex.get('VIVK').articles.get('vivk-20260728-houston-commissioning-report').linkedTrades.size", calendarContext) === 3, 'The date-only commissioning report links to all three next-day entries');
checkConsistency(calendarVm.runInContext("newsDateFallbackMatches({publicationDate:'2026-11-04'}, '2026-11-06T09:00:00-05:00', 2)", calendarContext), 'The previous two days qualify when the publication hour is missing');
checkConsistency(calendarVm.runInContext("newsDateFallbackMatches({publicationDate:'2026-11-06'}, '2026-11-06T09:00:00-05:00', 2)", calendarContext), 'Same-day date-only news counts by date under the revised user rule');
checkConsistency(calendarVm.runInContext("issuerNewsCell(dataset.tickerProfiles.ABTS)", calendarContext).includes('Sin revisar'), 'Unresearched tickers do not show zero news');
checkConsistency(calendarVm.runInContext("dataset.tickerProfiles.VIVK.vie_status", calendarContext) === 'unknown', 'Hiding VIE does not alter the canonical issuer profile');
const stalePayload = JSON.parse(JSON.stringify(calendarContext.realNewsPayload));
stalePayload.trades.forEach(trade => { trade.entryAt = '2000-01-01T00:00:00Z'; });
calendarContext.staleNewsPayload = stalePayload;
checkConsistency(calendarVm.runInContext("updateIssuerNews(staleNewsPayload, dataset); issuerNewsCell(dataset.tickerProfiles.VIVK)", calendarContext).includes('Sin revisar'), 'Stale entry links do not inherit reviewed news');
calendarVm.runInContext('updateIssuerNews(null, dataset);', calendarContext);
checkConsistency(calendarVm.runInContext("issuerNewsCell(dataset.tickerProfiles.VIVK)", calendarContext).includes('No disponibles'), 'Unavailable news does not claim no news');
checkConsistency(calendarVm.runInContext("newsSourceLink('javascript:alert(1)', '<script>')", calendarContext) === '&lt;script&gt;', 'News source links reject unsafe protocols and escape labels');
calendarContext.stabilityRows = [
  { date: '2026-12-31', pnl: 10 }, { date: '2027-01-03', pnl: -4 }, { date: '2027-01-04', pnl: 2 }
];
for (const [unit, expected] of [
  ['month', [['2026-12', 10], ['2027-01', -1]]],
  ['week', [['2026-12-28', 3], ['2027-01-04', 2]]],
  ['day', [['2026-12-31', 10], ['2027-01-03', -4], ['2027-01-04', 2]]]
]) {
  calendarElements.set('consistency-stability-period', { value: unit });
  calendarVm.runInContext('renderConsistencyStability(stabilityRows)', calendarContext);
  const values = calendarVm.runInContext("renderedCalendarCharts.get('monthly-expectancy-chart')[0].values.map(point => point.slice(0, 2))", calendarContext);
  checkConsistency(JSON.stringify(values) === JSON.stringify(expected), 'Stability grouping preserves per-period trade denominators and year boundaries');
  if (unit === 'week') checkConsistency(calendarElements.get('monthly-consistency-table').innerHTML.includes('Semana del 2026-12-28'), 'Weekly stability table matches the chart');
}
calendarVm.runInContext('renderConsistencyStability([])', calendarContext);
checkConsistency(calendarElements.get('monthly-consistency-table').innerHTML.includes('Sin operaciones'), 'Empty stability filters clear the detail table');
checkConsistency(calendarFs.readFileSync(calendarPath.join(__dirname, '..', 'index.html'), 'utf8').includes('id="consistency-stability-period"><option value="month">Mensual</option><option value="week" selected>Semanal'), 'Stability defaults to weekly');
calendarContext.concentrationRows = [
  { symbol: 'A', pnl: 10 }, { symbol: 'A', pnl: -4 }, { symbol: 'B', pnl: -2 }, { symbol: 'C', pnl: 2 }
].map(trade => ({ ...trade, date: '2026-11-06', opened: '2026-11-06T09:00:00-05:00' }));
calendarVm.runInContext('globalThis.concentrated = concentrationGroups(concentrationRows, trade => trade.symbol)', calendarContext);
const concentrated = calendarContext.concentrated;
checkConsistency(concentrated.map(group => group.weight).join(',') === '75,25,0', 'Concentration weights use positive net group PnL, not net total or gross winning trades');
checkConsistency(concentrated.map(group => group.without).join(',') === '0,4,8', 'Excluding a losing group increases remaining PnL');
checkConsistency(calendarVm.runInContext("concentrationGroups([{symbol: 'A', pnl: -4}], trade => trade.symbol)[0].weight", calendarContext) === null, 'Concentration weights stay undefined when no groups have positive PnL');
calendarVm.runInContext("dataset = { tickerProfiles: { A: { incorporation_country: 'Cayman Islands', operating_country: 'China' }, B: { operating_country: 'United States' } } }", calendarContext);
for (const dimension of ['symbol', 'country', 'time', 'weekday']) {
  calendarElements.set('consistency-concentration', { value: dimension });
  calendarVm.runInContext('renderConsistencyConcentration(concentrationRows)', calendarContext);
  const series = calendarVm.runInContext("renderedCalendarCharts.get('consistency-concentration-pnl')[0].values", calendarContext);
  checkConsistency(series.reduce((total, point) => total + point[1], 0) === 6, 'Each concentration dimension reconciles total PnL');
  if (dimension === 'country') checkConsistency(series.some(point => point[0] === 'Cayman Islands') && series.some(point => point[0] === 'Sin clasificar') && !series.some(point => point[0] === 'China'), 'Concentration uses incorporation country exclusively');
}
const horizontal = calendarVm.runInContext("svgChart([{values: [['A', 6, '2 trades'], ['C', 2, '1 trade'], ['B', -2, '1 trade']]}], {horizontal: true, currency: true, width: 800, title: 'PnL', explanation: 'Test'})", calendarContext);
checkConsistency((horizontal.match(/<rect /g) || []).length === 3 && !/NaN|Infinity|undefined/.test(horizontal), 'Horizontal concentration renders all positive and negative groups');
for (const value of [0, -1, 1]) {
  calendarContext.horizontalValue = value;
  const markup = calendarVm.runInContext("svgChart([{values: [['A', horizontalValue, '1 trade']]}], {horizontal: true, currency: true, width: 320, title: 'PnL', explanation: 'Test'})", calendarContext);
  checkConsistency(!/NaN|Infinity|undefined/.test(markup), 'Single-group concentration renders zero, losses and gains on narrow charts');
}
calendarVm.runInContext('renderConsistencyConcentration([])', calendarContext);
checkConsistency(calendarVm.runInContext("renderedCalendarCharts.get('consistency-concentration-weight')[0].values.length", calendarContext) === 0, 'Empty concentration filters clear every chart');
console.log('Consistency, stability periods, graphical concentration, calendar, comparisons and ticker news checks passed.');
