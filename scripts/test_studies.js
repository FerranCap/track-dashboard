'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const elements = new Map();
const context = vm.createContext({ document: { getElementById(id) {
  assert.ok(html.includes(`id="${id}"`), `Missing study render target ${id}`);
  if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', clientWidth: 800, clientHeight: 275, setAttribute() {} });
  return elements.get(id);
} } });
const source = fs.readFileSync(path.join(root, 'dashboard.js'), 'utf8');
vm.runInContext(source.slice(0, source.indexOf("$('search').addEventListener")), context);
for (const file of ['help.js', 'consistency.js', 'workspace.js', 'duration.js', 'studies.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
}
const evaluate = code => vm.runInContext(code, context);
context.profiles = {
  CAY: { incorporation_country: 'Cayman Islands', operating_country: 'China' },
  US: { incorporation_country: 'United States', headquarters_country: 'China' },
  UNKNOWN: { operating_country: 'China', headquarters_country: 'United States' },
  EMPTY: { incorporation_country: 'unknown', operating_country: 'Canada' }
};
context.rows = [
  { symbol: 'CAY', pnl: 10, entryPrice: 0.1, entryQty: 10, holdMinutes: 0 },
  { symbol: 'US', pnl: -4, entryPrice: 0.3, entryQty: 20, holdMinutes: 5 },
  { symbol: 'UNKNOWN', pnl: 6, entryPrice: null, entryQty: null, holdMinutes: null, country: 'United States' },
  { symbol: 'CAY', pnl: 0, entryPrice: 0.29999, entryQty: 0, holdMinutes: 10 },
  { symbol: 'CAY', pnl: -2, entryPrice: 0.3, entryQty: 5, holdMinutes: -1 },
  { symbol: 'EMPTY', pnl: 4, entryPrice: -1, entryQty: Infinity, holdMinutes: 15 }
].map((trade, index) => ({ ...trade, id: String(index), date: '2026-11-06', fees: 0.1 }));
evaluate('dataset = { tickerProfiles: profiles, trades: rows }');
const snapshot = JSON.stringify(context.rows);
evaluate('globalThis.countries = countryStudyGroups(rows)');
assert.deepEqual(Array.from(context.countries, group => group.name), ['Cayman Islands', 'United States', 'Sin clasificar']);
const cayman = context.countries[0], unknown = context.countries[2];
assert.equal(cayman.count, 3);
assert.equal(cayman.pnl, 8);
assert.equal(cayman.rr, 5);
assert.equal(cayman.pf, 5);
assert.equal(cayman.quantity, 15);
assert.equal(cayman.averageQuantity, 7.5);
assert.equal(cayman.durationCount, 2);
assert.equal(cayman.mean, 5);
assert.equal(cayman.median, 5);
assert.equal(unknown.count, 2, 'Operating country, headquarters and trade.country cannot substitute incorporation country');
assert.equal(unknown.pnl, 10);
assert.equal(unknown.pf, Infinity);
assert.equal(unknown.quantity, null, 'Missing, zero and infinite quantities must not be treated as known volume');
for (const width of [0.1, 0.25, 0.5, 1, 2, 5, 10]) {
  elements.set('price-range-width', { value: String(width) });
  evaluate('renderPrice(rows); globalThis.prices = priceStudyGroups(rows, Number(document.getElementById("price-range-width").value))');
  assert.equal(context.prices.reduce((total, group) => total + group.count, 0), 6);
  assert.equal(context.prices.reduce((total, group) => total + group.pnl, 0), 14);
  assert.equal(context.prices.at(-1).name, 'Sin precio');
  assert.equal(context.prices.at(-1).count, 2);
  assert.match(elements.get('price-table').innerHTML, /Sin precio/);
  assert.match(elements.get('price-caption').textContent, /2 sin precio/);
}
evaluate('globalThis.prices = priceStudyGroups(rows, 0.1)');
assert.equal(context.prices[2].name, '$0.30 – $0.40');
assert.equal(context.prices[2].count, 2, 'Exact decimal boundaries must enter the next range');
evaluate('renderCountries(rows)');
assert.match(elements.get('country-table').innerHTML, /Sin clasificar/);
assert.ok(!elements.get('country-table').innerHTML.includes('China'));
assert.equal((elements.get('country-scatter-pnl').innerHTML.match(/<circle /g) || []).length, 6);
assert.equal((elements.get('country-scatter-quantity').innerHTML.match(/<circle /g) || []).length, 3);
assert.equal((elements.get('price-scatter-pnl').innerHTML.match(/<circle /g) || []).length, 4);
assert.equal((elements.get('price-scatter-duration').innerHTML.match(/<circle /g) || []).length, 3);
assert.ok(!elements.get('price-scatter-pnl').innerHTML.includes('>Duración (min)</text>'), 'Price scatter must label its own X axis');
assert.ok(!elements.get('country-scatter-pnl').innerHTML.includes('>Duración (min)</text>'), 'Country scatter must use category labels');
assert.equal(evaluate('chartConfigs.size'), 28);
assert.equal(JSON.stringify(context.rows), snapshot, 'Study rendering must preserve all trade accounting');
for (const subset of ['rows.slice(0, 1)', 'rows.slice(2, 3)', '[]']) {
  evaluate(`renderPrice(${subset}); renderCountries(${subset})`);
  for (const [id, element] of elements) if (typeof element.innerHTML === 'string') assert.ok(!/NaN|Infinity|undefined/.test(element.innerHTML), `Invalid rendered value in ${id}`);
}
assert.match(elements.get('price-table').innerHTML, /Sin operaciones/);
assert.match(elements.get('country-table').innerHTML, /Sin operaciones/);
context.realData = JSON.parse(fs.readFileSync(path.join(root, 'data', 'trades.json'), 'utf8'));
evaluate('dataset = realData; renderPrice(realData.trades); renderCountries(realData.trades); globalThis.realCountries = countryStudyGroups(realData.trades); globalThis.realPrices = priceStudyGroups(realData.trades, 0.1)');
const expectedPnl = context.realData.trades.reduce((total, trade) => total + trade.pnl, 0);
for (const groups of [context.realCountries, context.realPrices]) {
  assert.equal(groups.reduce((total, group) => total + group.count, 0), context.realData.trades.length);
  assert.ok(Math.abs(groups.reduce((total, group) => total + group.pnl, 0) - expectedPnl) < 1e-6);
}
console.log('Price and incorporation-country studies: boundaries, unknowns, ratios, valid denominators, filters, scatter axes, render targets and full-history totals verified.');
