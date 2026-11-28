'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');

class Element {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.handlers = {};
    this.attributes = {};
    this.style = {};
    this.value = '';
    this.innerHTML = '';
    this.open = false;
    this.classList = { add() {} };
  }
  append(...items) { this.children.push(...items); }
  prepend(...items) { this.children.unshift(...items); }
  replaceChildren(...items) { this.children = items; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, handler) { this.handlers[type] = handler; }
  emit(type) { this.handlers[type]?.({ target: this }); }
}
const document = { activeElement: null, createElement: tag => new Element(tag), createTextNode: text => ({ textContent: text }) };
const context = vm.createContext({ console, Intl, Date, Map, Set, URL, document });
const load = file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'dashboard.js'), 'utf8').split("$('search').addEventListener")[0], context);
load('workspace.js');
load('consistency.js');
load('sec-capital.js');
load('news.js');
load('watchlist-similar.js');
const run = code => vm.runInContext(code, context);
context.source = JSON.parse(fs.readFileSync(path.join(root, 'data/trades.json'), 'utf8'));
context.capital = JSON.parse(fs.readFileSync(path.join(root, 'data/sec/trade-capital.json'), 'utf8'));
context.risk = JSON.parse(fs.readFileSync(path.join(root, 'data/session-risk.json'), 'utf8'));
context.news = JSON.parse(fs.readFileSync(path.join(root, 'data/news/trade-context.json'), 'utf8'));
const baseline = JSON.stringify(context.source);
run('dataset = source; sessionRiskHistory = risk; updateIssuerNews(news, source); updateSecCapital(capital, source); var index = buildWatchlistSimilarityIndex(source, secCapitalIssuers, secCapitalTrades);');

// Initial ranges use the entry values in millions, not USD/R conversion.
const defaults = run('watchlistSearchDefaults({country:"China", float:"10", marketCap:"20"})');
assert.equal(defaults.float.min, 7);
assert.equal(defaults.float.max, 13);
assert.equal(defaults.marketCap.min, 14);
assert.equal(defaults.marketCap.max, 26);
assert.equal(run('watchlistSearchNumber("")'), null);
assert.equal(run('watchlistSearchNumber("1,5")'), 1.5);
assert.equal(run('watchlistSearchDefaults({float:0}).float.enabled'), false);
assert.equal(run('watchlistSearchDefaults({float:null}).float.enabled'), false);

// Historical figures must have been published before the entry.
context.syntheticIssuer = {
  quotedShareClass: 'Class A', events: [],
  filings: { annual: { filedOn: '2026-01-10', acceptedAt: null } },
  observations: [{ id: 'float', metric: 'floatShares', value: 1e6, asOf: '2025-12-31', shareClass: 'Class A', filingId: 'annual' }]
};
assert.equal(run('watchlistFloatAtEntry(syntheticIssuer, {opened:"2026-01-09T10:00:00-05:00"})'), null);
assert.equal(run('watchlistFloatAtEntry(syntheticIssuer, {opened:"2026-01-10T10:00:00-05:00"})'), null);
assert.equal(run('watchlistFloatAtEntry(syntheticIssuer, {opened:"2026-01-11T10:00:00-05:00"}).value'), 1e6);
run('syntheticIssuer.events.push({asOf:"2026-01-10", affectsShareBasis:true, filingId:"annual"})');
assert.equal(run('watchlistFloatAtEntry(syntheticIssuer, {opened:"2026-01-11T10:00:00-05:00"})'), null);
run('syntheticIssuer.observations[0].shareBasisDate="2026-01-10"');
assert.equal(run('watchlistFloatAtEntry(syntheticIssuer, {opened:"2026-01-11T10:00:00-05:00"}).value'), 1e6);
run('syntheticIssuer.filings.annual.acceptedAt="2026-01-10T10:00:00-05:00"');
assert.equal(run('watchlistFloatAtEntry(syntheticIssuer, {opened:"2026-01-10T10:00:00-05:00"})'), null);
assert.equal(run('watchlistFloatAtEntry(syntheticIssuer, {opened:"2026-01-10T10:00:01-05:00"}).value'), 1e6);

// Only incorporation country defines the country cohort.
run('var countrySearch = watchlistSearchDefaults({country:"United States"}); var matches = findWatchlistSimilar({ticker:"WATCH"}, countrySearch, index, source.tickerProfiles);');
assert.ok(run('matches.groups.length') > 0);
assert.equal(run('matches.trades.every(t => source.tickerProfiles[t.symbol].incorporation_country === "United States")'), true);
assert.equal(run('findWatchlistSimilar({ticker:"AMD"}, countrySearch, index, source.tickerProfiles).groups.some(g => g.symbol === "AMD")'), false);
assert.equal(run('findWatchlistSimilar({ticker:"WATCH"}, watchlistSearchDefaults({}), index).groups.length'), 0);
assert.equal(run('findWatchlistSimilar({ticker:"ALIAS"}, countrySearch, index, {...source.tickerProfiles, ALIAS:{cik:source.tickerProfiles.AMD.cik}}).groups.some(g=>g.symbol==="AMD")'), false);

// Inclusive numeric limits and missing values are independent of zero.
context.syntheticRecords = [
  { trade: { id: 'a', symbol: 'A' }, profile: {}, country: 'China', float: {value:7e6}, marketCap: {value:26e6} },
  { trade: { id: 'b', symbol: 'B' }, profile: {}, country: 'China', float: {value:13e6}, marketCap: {value:14e6} },
  { trade: { id: 'c', symbol: 'C' }, profile: {}, country: 'China', float: null, marketCap: {value:20e6} },
  { trade: { id: 'd', symbol: 'D' }, profile: {}, country: 'China', float: {value:13.01e6}, marketCap: {value:20e6} }
];
run('var numericSearch = watchlistSearchDefaults({country:"China",float:10,marketCap:20}); var numericMatches=findWatchlistSimilar({ticker:"WATCH"}, numericSearch, syntheticRecords);');
assert.equal(run('numericMatches.groups.length'), 2);
assert.equal(run('numericMatches.missingTrades'), 1);
assert.equal(run('numericMatches.outsideTrades'), 1);
run('numericSearch.float.min=0; numericSearch.float.max=0');
assert.equal(run('findWatchlistSimilar({ticker:"WATCH"}, numericSearch, syntheticRecords).invalid.length'), 1);

// Partial class values must not be compared with total issuer market cap.
assert.equal(run('index.filter(r => r.trade.symbol === "BENF").every(r => r.marketCap === null)'), true);
assert.equal(run('index.some(r => r.trade.symbol === "BENF" && r.partialMarketCap)'), true);
assert.equal(run('index.some(r => r.trade.symbol === "AMD" && r.marketCap)'), true);

// Shared percentage settings are applied independently to each ticker's values.
const shared = { country: false, float: { enabled: true, below: 20, above: 50 }, marketCap: { enabled: false, below: 30, above: 30 } };
context.shared = shared;
const configured = run('watchlistSearchDefaults({country:"China", float:10, marketCap:20}, shared)');
assert.equal(configured.country, '');
assert.equal(configured.float.min, 8);
assert.equal(configured.float.max, 15);
assert.equal(configured.marketCap.enabled, false);
const other = run('watchlistSearchDefaults({float:50}, shared)');
assert.equal(other.float.min, 40);
assert.equal(other.float.max, 75);
assert.equal(run('watchlistSearchDefaults({float:null}, shared).float.enabled'), false);

// Historical R conversion applies to PnL, and missing R is disclosed.
context.noRiskTrade = {id:'no-risk', symbol:'A', opened:'2024-01-02T10:00:00-05:00', date:'2024-01-02', pnl:100};
run('pnlDisplayUnit="r"');
assert.match(run('watchlistSimilarStats([noRiskTrade])'), /sin R histórica/);
assert.doesNotMatch(run('watchlistSimilarStats([noRiskTrade])'), /0\.00 R/);
run('pnlDisplayUnit="usd"');
const actualMarkup = run('watchlistSimilarMarkup(matches)');
assert.match(actualMarkup, /historial completo/);
assert.match(actualMarkup, /referencias y sesiones/);
assert.match(actualMarkup, /Mostrar siguientes/);
assert.match(actualMarkup, /Ficha del emisor/);
assert.match(actualMarkup, /Noticias/);
const malicious = run('findWatchlistSimilar({ticker:"WATCH"}, countrySearch, index, source.tickerProfiles)');
malicious.groups[0].profile = {...malicious.groups[0].profile, issuer_name:'<script>alert(1)</script>'};
context.malicious = malicious;
assert.doesNotMatch(run('watchlistSimilarMarkup(malicious)'), /<script>/);
assert.equal(JSON.stringify(context.source), baseline);

// News is restricted to the matched entries and preserves date-only caveats.
run(`var selectedTrade = {id:'selected',opened:'2026-11-24T10:00:00-05:00'};
var otherTrade = {id:'other',opened:'2026-11-23T10:00:00-05:00'};
var newsGroup = {symbol:'TESTNEWS',records:[{trade:selectedTrade}]};
issuerNewsIndex.set('TESTNEWS', {reviewedEntries:new Map([['selected',selectedTrade.opened],['other',otherTrade.opened]]),
articles:new Map([
  ['selected-article',{url:'https://example.com/selected',headline:'Selected headline',publisher:'Issuer',summary:'Reviewed publication.',timePrecision:'day',publicationDate:'2026-11-24',sourceWarnings:['Source discrepancy retained.'],linkedTrades:new Map([['selected',selectedTrade]])}],
  ['other-article',{headline:'Unrelated entry headline',linkedTrades:new Map([['other',otherTrade]])}]
])});`);
const selectedNews = run('watchlistSimilarNews(newsGroup)');
assert.match(selectedNews, /Selected headline/);
assert.match(selectedNews, /1 de 1 trades revisados/);
assert.match(selectedNews, /anterior a la entrada sin confirmar/);
assert.match(selectedNews, /Source discrepancy retained/);
assert.doesNotMatch(selectedNews, /Unrelated entry headline/);

const watchlist = fs.readFileSync(path.join(root, 'watchlist.js'), 'utf8');
assert.ok(watchlist.indexOf('body.append(linksRow)') < watchlist.indexOf('body.append(similar.row)'));
assert.match(watchlist, /similarityPanels\.get\(entry\.ticker\)\?\.refresh/);
console.log('Watchlist similarity and independent range controls passed.');
