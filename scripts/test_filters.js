'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
for (const file of ['workspace.js', 'news.js', 'filters.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));

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
const durationRows = [0, 0.5, 5, 15, 60, null, undefined, -1].map((holdMinutes, index) => ({ ...rows[0], id: String(index), holdMinutes }));
const durationMatching = overrides => selectFilteredTrades(durationRows, profiles, { ...defaults, ...overrides }).map(trade => trade.id);
assert.equal(durationMatching({}).length, durationRows.length, 'Unrestricted duration preserves missing values');
assert.deepEqual(durationMatching({ durationMin: 0.5, durationMax: 15 }), ['1', '2', '3'], 'Duration bounds include exact endpoints and decimals');
assert.deepEqual(durationMatching({ durationMax: 0 }), ['0'], 'Zero maximum restricts results to zero-duration trades');
assert.deepEqual(durationMatching({ durationMin: 15 }), ['3', '4'], 'Open-ended minimum excludes unavailable durations');
assert.deepEqual(durationMatching({ durationMin: 20, durationMax: 10 }), [], 'Reversed duration limits are invalid');
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
function deferredPanel(prototype = TradeFilterPanel.prototype) {
  const draft = { period: { value: 'all' }, from: { value: '' }, to: { value: '' }, symbol: { value: '' }, side: { value: 'all' }, news: { value: '0' } };
  const bounds = { time: { min: { value: '00:00' }, max: { value: '23:59' } }, price: { min: { value: '0' }, max: { value: '' } }, duration: { min: { value: '0' }, max: { value: '' } } };
  const sliders = { time: { min: { value: '0' }, max: { value: '1439' } } };
  const status = { textContent: '', classList: { toggle() {} } };
  const instance = Object.create(prototype);
  let scans = 0, renders = 0;
  instance.rows = rows.slice();
  instance.rows.filter = callback => { scans++; return rows.filter(callback); };
  Object.assign(instance, { profiles, countries: new Set(), initialSide: 'all', pending: false, validationMessage: '', appliedCount: 0,
    host: { querySelector: selector => selector === '.filter-count' ? status : { hidden: true }, querySelectorAll: selector => selector === 'input' ? [{ validity: { valid: true } }] : [] },
    field: key => draft[key], bound: (kind, bound) => bounds[kind][bound], slider: (kind, bound) => sliders[kind][bound], syncRange() {}, syncNewsRange() {},
    onChange() { renders++; instance.matchingRows(); }
  });
  instance.appliedCriteria = instance.snapshot();
  instance.matchingRows();
  return { instance, draft, bounds, sliders, status, scans: () => scans, renders: () => renders };
}

globalThis.integerFormat = new Intl.NumberFormat('es-ES');
const general = deferredPanel(), groupA = deferredPanel(), groupB = deferredPanel();
general.draft.symbol.value = 'us';
general.instance.handleInput({ target: { dataset: { field: 'symbol' } } });
for (let index = 0; index < 100; index++) {
  general.sliders.time.min.value = String(index);
  general.instance.handleInput({ target: { ...general.sliders.time.min, dataset: { slider: 'time', bound: 'min' } } });
}
assert.equal(general.scans(), 1, 'Draft edits and slider dragging must not scan trades');
assert.equal(general.renders(), 0, 'Draft edits must not rerender the dashboard');
assert.match(general.status.textContent, /Cambios sin aplicar/);
assert.equal(general.instance.matchingRows().length, rows.length, 'Unrelated renders must keep applied criteria');
general.instance.apply();
assert.equal(general.renders(), 1);
assert.deepEqual(general.instance.matchingRows().map(trade => trade.id), ['a']);

groupA.instance.countries.add('Cayman Islands');
groupA.instance.changed();
groupA.instance.apply();
assert.deepEqual(groupA.instance.matchingRows().map(trade => trade.id), ['b']);
groupA.instance.countries.clear();
groupA.instance.changed();
groupB.draft.side.value = 'BUY';
groupB.instance.changed();
groupB.instance.apply();
assert.deepEqual(groupA.instance.matchingRows().map(trade => trade.id), ['b'], 'Applying B must not apply pending A edits');
assert.deepEqual(groupB.instance.matchingRows().map(trade => trade.id), ['a', 'c', 'd']);
assert.deepEqual(general.instance.matchingRows().map(trade => trade.id), ['a']);

general.bounds.price.min.value = '10';
general.bounds.price.max.value = '1';
general.instance.changed();
general.instance.apply();
assert.equal(general.renders(), 1, 'Invalid drafts must not update results');
assert.match(general.status.textContent, /Revisa los rangos/);
assert.deepEqual(general.instance.matchingRows().map(trade => trade.id), ['a']);
general.instance.reset();
assert.equal(general.renders(), 1, 'Clearing fields must wait for Apply');
assert.deepEqual(general.instance.matchingRows().map(trade => trade.id), ['a']);
general.instance.apply();
assert.equal(general.renders(), 2);
assert.equal(general.instance.matchingRows().length, rows.length);
const durationPanel = deferredPanel();
durationPanel.instance.rows = durationRows;
durationPanel.bounds.duration.min.value = '0.5';
durationPanel.bounds.duration.max.value = '15';
durationPanel.instance.handleInput({ target: { dataset: { kind: 'duration' } } });
assert.equal(durationPanel.instance.matchingRows().length, durationRows.length, 'Duration edits wait for Apply');
durationPanel.instance.apply();
assert.deepEqual(durationPanel.instance.matchingRows().map(trade => trade.id), ['1', '2', '3']);
assert.equal(groupB.instance.appliedCriteria.durationMax, Infinity, 'Duration filters remain independent between groups');
durationPanel.bounds.duration.min.value = '20';
durationPanel.instance.apply();
assert.match(durationPanel.status.textContent, /Revisa los rangos/);
assert.deepEqual(durationPanel.instance.matchingRows().map(trade => trade.id), ['1', '2', '3'], 'Invalid duration drafts preserve applied results');
durationPanel.instance.reset();
assert.equal(durationPanel.bounds.duration.min.value, '0');
assert.equal(durationPanel.bounds.duration.max.value, '');
durationPanel.instance.apply();
assert.equal(durationPanel.instance.matchingRows().length, durationRows.length, 'Reset removes duration restrictions');
// Isolate the group lifecycle from DOM layout; filter draft behavior is tested above.
const originalPanelClass = TradeFilterPanel, originalComparisonRender = renderComparisons;
const groupNodes = new Map();
const groupNode = id => {
  if (!groupNodes.has(id)) groupNodes.set(id, {
    id, style: { setProperty(name, value) { this[name] = value; } },
    focus() {}, remove() { groupNodes.delete(this.id); }, insertBefore() {},
    querySelector() { return this.removeButton ||= {}; },
    querySelectorAll() { return this.swatches ||= COMPARISON_COLORS.map(color => ({ dataset: { groupColor: color.value }, setAttribute(name, value) { this[name] = value; } })); }
  });
  return groupNodes.get(id);
};
globalThis.$ = groupNode;
globalThis.document = { createElement: () => groupNode(`node-${groupNodes.size}`) };
globalThis.initializeFilterControlHelp = () => {};
globalThis.dataset = { trades: rows, tickerProfiles: profiles };
globalThis.tableSortStates = new Map();
let comparisonRenders = 0;
renderComparisons = () => { comparisonRenders++; };
TradeFilterPanel = class {
  constructor(key, host, callback, side) {
    const view = deferredPanel(originalPanelClass.prototype);
    view.draft.side.value = side;
    view.instance.key = key;
    view.instance.appliedCriteria = view.instance.snapshot();
    view.instance.onChange = callback;
    view.instance.populate = () => {};
    return view.instance;
  }
};
assert.equal(addComparisonGroup('BUY').key, 'a');
assert.equal(addComparisonGroup('SELL').key, 'b');
assert.equal(removeComparisonGroup('a'), false, 'At least two groups remain');
assert.equal(setComparisonGroupColor('a', '#B79AFF'), true);
assert.equal(setComparisonGroupColor('b', '#B79AFF'), false, 'Colors cannot be duplicated');
assert.equal(setComparisonGroupColor('a', '#ffffff'), false, 'Only the approved palette is accepted');
for (let index = 0; index < 4; index++) assert.ok(addComparisonGroup());
assert.equal(addComparisonGroup(), null, 'A seventh group must not be created');
assert.equal(groupNode('compare-add-group').disabled, true);
assert.equal(new Set(comparisonGroupList().map(group => group.color)).size, 6);
const pendingGroup = tradeFilterPanels.get('b');
pendingGroup.countries.add('Cayman Islands'); pendingGroup.changed();
assert.equal(removeComparisonGroup('d'), true);
assert.equal(tradeFilterPanels.has('d'), false);
assert.equal(groupNode('compare-add-group').disabled, false);
assert.equal(addComparisonGroup().key, 'd', 'Deleted group slots can be reused');
assert.deepEqual(comparisonGroupList().map(group => group.key), ['a', 'b', 'c', 'd', 'e', 'f']);
assert.equal(tradeFilterPanels.get('b'), pendingGroup, 'Adding or deleting groups must preserve other filter panels');
assert.equal(pendingGroup.pending, true);
assert.equal(pendingGroup.appliedCriteria.countries.size, 0, 'Group management must not apply pending filters');
assert.ok(comparisonRenders > 0);
TradeFilterPanel = originalPanelClass;
renderComparisons = originalComparisonRender;
const newsTrades = ['timed', 'previous-day', 'two-days', 'same-day', 'too-old', 'unknown', 'wrong-issuer', 'future'].map(id => ({ ...rows[0], id, opened: '2026-11-06T12:00:00-05:00' }));
const newsArticles = [
  { id: 'timed', publishedAt: '2026-11-06T10:00:00-05:00', timePrecision: 'minute', verificationStatus: 'verified_publication' },
  { id: 'previous-day', publishedAt: null, publicationDate: '2026-11-05', timePrecision: 'day', verificationStatus: 'verified_date' },
  { id: 'two-days', publishedAt: null, publicationDate: '2026-11-04', timePrecision: 'day', verificationStatus: 'verified_date' },
  { id: 'same-day', publishedAt: null, publicationDate: '2026-11-06', timePrecision: 'day', verificationStatus: 'verified_date' },
  { id: 'too-old', publishedAt: '2026-11-04T11:00:00-05:00', publicationDate: '2026-11-04', timePrecision: 'minute', verificationStatus: 'verified_publication' },
  { id: 'wrong-issuer', issuerCik: '2', publishedAt: '2026-11-06T11:00:00-05:00', timePrecision: 'minute', verificationStatus: 'verified_publication' },
  { id: 'future', publishedAt: '2026-11-06T12:00:00-05:00', timePrecision: 'minute', verificationStatus: 'verified_publication' }
].map(article => ({ symbol: 'US', issuerCik: '1', ...article }));
const newsSource = { trades: newsTrades, tickerProfiles: { US: { cik: '1', incorporation_country: 'United States' } } };
const newsPayload = { schemaVersion: 1, windowHours: 48, dateFallbackDays: 2, scopedSymbols: ['US'], articles: newsArticles, reviews: [],
  trades: newsTrades.map(trade => ({ tradeId: trade.id, symbol: trade.symbol, entryAt: trade.opened, articles: trade.id === 'unknown' ? [] : [{ articleId: trade.id }] })) };
updateIssuerNews(newsPayload, newsSource);
const filterNews = hours => selectFilteredTrades(newsTrades, newsSource.tickerProfiles, { ...defaults, newsHours: hours }).map(trade => trade.id);
assert.equal(filterNews(0).length, newsTrades.length, 'Zero disables news filtering rather than requiring a zero-hour window');
assert.deepEqual(filterNews(1.99), ['same-day']);
assert.deepEqual(filterNews(2), ['timed', 'same-day'], 'Exact publication timestamps use elapsed hours and inclusive lookback');
assert.deepEqual(filterNews(23.99), ['timed', 'same-day'], 'Previous-day date-only news must not enter before 24 hours');
assert.deepEqual(filterNews(24), ['timed', 'previous-day', 'same-day']);
assert.deepEqual(filterNews(47.99), ['timed', 'previous-day', 'same-day']);
assert.deepEqual(filterNews(48), ['timed', 'previous-day', 'two-days', 'same-day']);
assert.equal(tradeNewsAgeIndex.get('same-day').filterAgeHours, 0, 'Same-day date matches use the zero-age band, without inventing a publication timestamp');
assert.ok(!tradeNewsAgeIndex.has('too-old'), 'Known timestamps outside 48 hours cannot fall back to publication dates');
assert.ok(!tradeNewsAgeIndex.has('unknown'), 'Unreviewed trades are not invented news matches');
assert.ok(!tradeNewsAgeIndex.has('wrong-issuer'), 'News filtering validates issuer identity');
assert.ok(!tradeNewsAgeIndex.has('future'), 'Publication at entry is excluded');
assert.equal(tradeHasNewsWithin({ ...newsTrades[0], opened: '2026-11-06T12:01:00-05:00' }, 48), false, 'Changed entry times invalidate cached links');
const newsPanel = deferredPanel(), otherNewsPanel = deferredPanel();
newsPanel.instance.rows = newsTrades;
newsPanel.instance.profiles = newsSource.tickerProfiles;
newsPanel.draft.news.value = '50';
newsPanel.instance.handleInput({ target: { dataset: { field: 'news' } } });
assert.equal(newsPanel.instance.matchingRows().length, newsTrades.length, 'Slider edits do not apply before pressing Apply');
newsPanel.instance.apply();
assert.equal(newsPanel.instance.appliedCriteria.newsHours, 24);
assert.deepEqual(newsPanel.instance.matchingRows().map(trade => trade.id), ['timed', 'previous-day', 'same-day']);
assert.equal(otherNewsPanel.instance.appliedCriteria.newsHours, 0, 'Comparison groups keep independent news windows');
newsPanel.draft.news.value = '100';
assert.equal(newsPanel.instance.matchingRows().length, 3, 'Pending news slider changes do not affect unrelated renders');
newsPanel.instance.apply();
assert.equal(newsPanel.instance.matchingRows().length, 4);
newsPanel.instance.reset();
assert.equal(newsPanel.draft.news.value, '0');
newsPanel.instance.apply();
assert.equal(newsPanel.instance.matchingRows().length, newsTrades.length);
const output = {}, rangeStyle = {}, rangeAttributes = {};
const rangeInput = { value: '50', style: { setProperty(key, value) { rangeStyle[key] = value; } }, setAttribute(key, value) { rangeAttributes[key] = value; } };
const rangePanel = { field: () => rangeInput, host: { querySelector: () => output } };
for (const [position, label] of [['0', 'Sin filtro'], ['25', '12 h'], ['50', '24 h'], ['100', '48 h']]) {
  rangeInput.value = position;
  TradeFilterPanel.prototype.syncNewsRange.call(rangePanel);
  assert.equal(output.textContent, label);
  assert.equal(rangeAttributes['aria-valuetext'], label);
  assert.equal(rangeStyle['--news-fill'], `${position}%`);
}
const midnightTrade = { ...newsTrades[1], opened: '2026-11-06T04:30:00Z' };
updateIssuerNews({ ...newsPayload, articles: [{ ...newsArticles[1], publicationDate: '2026-11-04' }], trades: [{ tradeId: midnightTrade.id, symbol: 'US', entryAt: midnightTrade.opened, articles: [{ articleId: 'previous-day' }] }] }, { ...newsSource, trades: [midnightTrade] });
assert.equal(tradeHasNewsWithin(midnightTrade, 24), true, 'Calendar-day bands follow entry day in New York, not UTC or closing day');
const dstTrade = { ...newsTrades[0], opened: '2026-11-02T00:30:00-05:00' };
updateIssuerNews({ ...newsPayload, articles: [{ ...newsArticles[0], publishedAt: '2026-10-31T01:00:00-04:00' }], trades: [{ tradeId: dstTrade.id, symbol: 'US', entryAt: dstTrade.opened, articles: [{ articleId: 'timed' }] }] }, { ...newsSource, trades: [dstTrade] });
assert.equal(tradeHasNewsWithin(dstTrade, 48), false, 'Known timestamps use elapsed hours across daylight-saving changes');
const sharedTrade = { ...newsTrades[0], id: 'shared-publication', symbol: 'OTHER' };
const sharedSource = { trades: [sharedTrade], tickerProfiles: { OTHER: { cik: '2' } } };
const sharedArticle = { ...newsArticles[0], additionalIssuers: [{ symbol: 'OTHER', issuerCik: '2' }] };
const sharedPayload = { ...newsPayload, scopedSymbols: ['OTHER'], articles: [sharedArticle], trades: [
  { tradeId: sharedTrade.id, symbol: 'OTHER', entryAt: sharedTrade.opened, articles: [{ articleId: sharedArticle.id }] }
] };
updateIssuerNews(sharedPayload, sharedSource);
assert.equal(tradeHasNewsWithin(sharedTrade, 48), true, 'One publication can link an additional issuer with its own verified CIK');
sharedArticle.additionalIssuers[0].issuerCik = '3';
updateIssuerNews(sharedPayload, sharedSource);
assert.equal(tradeHasNewsWithin(sharedTrade, 48), false, 'Additional issuers cannot bypass identity validation');
updateIssuerNews(null, newsSource);
assert.equal(tradeNewsAgeIndex.size, 0, 'Unavailable or refreshed news clears stale matches');
assert.equal(filterNews(48).length, 0);
assert.equal(filterNews(0).length, newsTrades.length, 'Unavailable news must not affect the unfiltered history');
const publishedData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'trades.json'), 'utf8'));
const publishedNews = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'news', 'trade-context.json'), 'utf8'));
updateIssuerNews(publishedNews, publishedData);
const allMatches = selectFilteredTrades(publishedData.trades, publishedData.tickerProfiles, { ...defaults, newsHours: 48 });
assert.equal(allMatches.length, publishedNews.counts.tradesWithNews, 'Full news window reconciles the curated trade links including date-only evidence');
assert.equal(selectFilteredTrades(publishedData.trades, publishedData.tickerProfiles, { ...defaults, newsHours: 0 }).length, publishedData.trades.length);
for (const trade of publishedData.trades) {
  const expected = publishedNews.trades.find(entry => entry.tradeId === trade.id)?.articles || [];
  const byId = new Map(publishedNews.articles.map(article => [article.id, article]));
  for (const hours of [0.48, 12, 24, 48]) {
    const matched = expected.some(link => {
      const article = byId.get(link.articleId);
      const age = article.timePrecision === 'day' ? 24 * link.daysBeforeEntry : (Date.parse(trade.opened) - Date.parse(article.publishedAt)) / 3600000;
      return age <= hours;
    });
    assert.equal(tradeHasNewsWithin(trade, hours), matched, `Published news filter: ${trade.id} at ${hours} hours`);
  }
}
console.log('Trade filters, news windows and date-only bands, deferred edits and independent comparison groups verified.');
