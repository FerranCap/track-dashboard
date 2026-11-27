'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const context = vm.createContext({ Intl, Date, Map, Number, Object, console, fetch: () => { throw Error('Unexpected network access'); }, esc: value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;') });
vm.runInContext(fs.readFileSync(path.join(root,'trade-price-chart.js'),'utf8'), context);
const run = code => vm.runInContext(code,context);
const dataset = JSON.parse(fs.readFileSync(path.join(root,'data/trades.json'),'utf8'));
const trades = dataset.trades.filter(t => t.symbol === 'BENF' && t.date === '2026-11-24');
const index = JSON.parse(fs.readFileSync(path.join(root,'data/prices/index.json'),'utf8'));
const session = index.tickers.BENF['2026-11-24'];
context.executionPayload = JSON.parse(fs.readFileSync(path.join(root,session.executionsFile),'utf8'));
for (const trade of trades) {
  context.trade = trade;
  const window = run('tradePriceWindow(trade,5)');
  assert.equal(window.start, Math.floor(Date.parse(trade.opened)/60000)*60-300);
  assert.equal(window.end, Math.floor(Date.parse(trade.closed)/60000)*60+360);
  assert(window.end-window.start < 25*60, 'View stays close to the trade');
  const fills = run('tradePriceFills(executionPayload,trade)');
  assert(fills.complete);
  assert.equal(fills.fills.length,trade.executionCount);
  assert(fills.fills.some(f => f.role === 'exit'));
  for (const source of session.sources) {
    context.payload = JSON.parse(fs.readFileSync(path.join(root,source.file),'utf8'));
    const result = run('tradePriceBars(payload,trade,5)');
    assert(result.bars.length > 0);
    assert(result.bars.length < context.payload.bars.length);
    assert.equal(result.window.start,window.start);
    assert.equal(result.window.end,window.end);
    const svg = run('priceChartSvg(tradePriceBars(payload,trade,5).bars,tradePriceWindow(trade,5),tradePriceFills(executionPayload,trade).fills,"BENF")');
    assert(svg.includes('trade-fill-marker'));
    assert(svg.includes('Volumen por minuto'));
    assert(!/NaN|Infinity/.test(svg));
  }
}
context.trade = {...trades[0], opened: '2026-11-24T13:25:13-05:00'};
assert.equal(run('tradePriceFills(executionPayload,trade).fills.length'),0, 'Stale execution evidence is rejected');
context.trade = {...trades[0], symbol:'AMD'};
assert.throws(() => run('tradePriceBars(payload,trade,5)'));
context.trade = {...trades[0], side:'SELL'};
assert.equal(run('tradePriceWindow(trade,5).start'), Math.floor(Date.parse(trades[0].opened)/60000)*60-300);
console.log('Price source isolation, trade windows, real execution markers and stale evidence checks passed.');
