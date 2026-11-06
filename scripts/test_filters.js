'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
for (const file of ['workspace.js', 'filters.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));

const profiles = {
  US: { incorporation_country: 'United States' },
  CN: { incorporation_country: 'Cayman Islands', operating_country: 'China' },
  UNKNOWN: { operating_country: 'United States', headquarters_country: 'Canada' }
};
const rows = [
  { id: 'a', symbol: 'US', date: '2026-11-06', opened: '2026-11-06T13:30:00Z', side: 'BUY', entryPrice: 0.5 },
  { id: 'b', symbol: 'CN', date: '2026-11-06', opened: '2026-11-06T14:15:59Z', side: 'SELL', entryPrice: 5 },
  { id: 'c', symbol: 'UNKNOWN', date: '2026-07-01', opened: '2026-07-01T12:30:00Z', side: 'BUY', entryPrice: null },
  { id: 'd', symbol: 'US', date: '2025-01-03', opened: 'invalid', side: 'BUY', entryPrice: 100 }
];
const defaults = { from: '', to: '', symbol: '', side: 'all', timeMin: 0, timeMax: 1439, priceMin: 0, priceMax: Infinity, countries: new Set() };
const matching = overrides => selectFilteredTrades(rows, profiles, { ...defaults, ...overrides }).map(trade => trade.id);
assert.deepEqual(matching({}), ['a', 'b', 'c', 'd']);
assert.deepEqual(matching({ from: '2026-11-06', to: '2026-11-06', timeMin: 510, timeMax: 555, priceMin: 0.5, priceMax: 5 }), ['a', 'b']);
assert.deepEqual(matching({ timeMin: 510, timeMax: 510 }), ['a', 'c']);
assert.equal(entryMinute(rows[0]), 510);
assert.equal(entryMinute(rows[2]), 510);
assert.deepEqual(matching({ countries: new Set(['Cayman Islands']) }), ['b']);
assert.deepEqual(matching({ countries: new Set(['China']) }), []);
assert.deepEqual(matching({ countries: new Set([UNKNOWN_FILTER_COUNTRY]) }), ['c']);
assert.deepEqual(matching({ countries: new Set(['United States', 'Cayman Islands']) }), ['a', 'b', 'd']);
assert.deepEqual(matching({ priceMax: 5 }), ['a', 'b']);
assert.deepEqual(matching({ symbol: 'US', side: 'SELL' }), []);
assert.deepEqual(matching({ from: '2026-11-07', to: '2026-11-06' }), []);
assert.deepEqual(matching({ timeMin: 600, timeMax: 500 }), []);
assert.deepEqual(matching({ priceMin: 5, priceMax: 1 }), []);

const fields = { period: { value: 'month:2024-02' }, from: { value: '' }, to: { value: '' } };
const range = { hidden: true };
const panel = { field: key => fields[key], host: { querySelector: () => range } };
TradeFilterPanel.prototype.setPeriod.call(panel);
assert.equal(fields.from.value, '2024-02-01');
assert.equal(fields.to.value, '2024-02-29');
fields.period.value = 'custom';
TradeFilterPanel.prototype.setPeriod.call(panel);
assert.equal(range.hidden, false);
fields.period.value = 'all';
TradeFilterPanel.prototype.setPeriod.call(panel);
assert.equal(fields.from.value, '');
assert.equal(fields.to.value, '');

const a = { ...defaults, countries: new Set(['United States']) };
const b = { ...defaults, side: 'SELL', countries: new Set() };
assert.deepEqual(selectFilteredTrades(rows, profiles, a).map(trade => trade.id), ['a', 'd']);
assert.deepEqual(selectFilteredTrades(rows, profiles, b).map(trade => trade.id), ['b']);
a.countries.clear();
assert.equal(selectFilteredTrades(rows, profiles, b).length, 1);
assert.equal(selectFilteredTrades(rows, profiles, a).length, rows.length);
console.log('Trade filter checks passed: combined ranges, NY daylight saving, country identity, unknown values, dates and independent groups.');
