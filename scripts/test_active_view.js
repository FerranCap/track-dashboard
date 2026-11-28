'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const elements = new Map(), calls = [];
const context = vm.createContext({ console, Intl, Date, Map, Set, URL, location: { hash: '#general' },
  document: { getElementById(id) { if (!elements.has(id)) elements.set(id, { innerHTML: '' }); return elements.get(id); } }, calls });
vm.runInContext(fs.readFileSync(path.join(root, 'dashboard.js'), 'utf8').split("$('search').addEventListener")[0], context);
vm.runInContext(fs.readFileSync(path.join(root, 'workspace.js'), 'utf8'), context);
const names = ['updateWatchlistTradeStats','renderCalendarResults','renderCalendar','renderPrice','renderDurationStudies','renderCountries','renderRatios','renderComparisons','renderMetrics','renderConsistencyStudies','renderGrowth','renderGrowthProjection','renderOptimal','renderJournal','renderTable','renderRecentSessions'];
for (const name of names) context[name] = () => calls.push(name);
context.renderChart = id => calls.push(id);
context.drawdownStats = () => ({ points: [] });
context.statistics = () => ({ pnl: 0, daily: [], wins: [], losses: [], pf: null, expectancy: 0, fees: 0, entryVolumes: 0, netByDate: [] });
context.metric = () => '';
context.equity = () => [];
vm.runInContext('dataset = {trades: []}; filtered = [];', context);
const scenarios = { general: ['renderRecentSessions', 'equity-chart'], watchlist: ['updateWatchlistTradeStats'], calendar: ['renderCalendarResults','renderCalendar'], price: ['renderPrice'], duration: ['renderDurationStudies'], country: ['renderCountries'], ratios: ['renderRatios'], compare: ['renderComparisons'], risk: ['renderMetrics','drawdown-chart','renderConsistencyStudies'], growth: ['renderGrowth'], projection: ['renderGrowthProjection'], optimal: ['renderOptimal'], trades: ['renderTable'], journal: ['renderJournal'], hotkeys: [] };
for (const [view, expected] of Object.entries(scenarios)) {
  calls.length = 0; context.location.hash = `#${view}`;
  vm.runInContext('renderActiveView()', context);
  assert.deepEqual(calls, expected, `${view} must render only its own views`);
}
console.log('Active-view rendering checks passed.');
