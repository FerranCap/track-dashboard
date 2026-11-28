'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const handlers = {};
const context = vm.createContext({ console, Intl, Date, Map, Set, URL, document: { addEventListener(type, callback) { handlers[type] = callback; } } });
const load = file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'dashboard.js'), 'utf8').split("$('search').addEventListener")[0], context);
for (const name of ['query-data.js', 'workspace.js', 'sec-capital.js', 'news.js', 'watchlist-similar.js']) load(name);
context.source = read('data/trades.json');
context.risk = read('data/session-risk.json');
context.capital = read('data/sec/trade-capital.json');
context.fullNews = read('data/news/trade-context.json');
context.compactNews = read('data/generated/news-index.json');
context.indexes = { trades: read('data/generated/trade-index.json'), similarity: read('data/generated/similarity-index.json') };
const run = code => vm.runInContext(code, context);
run('dataset = source; sessionRiskHistory = risk; updateSecCapital(capital, source);');
run('globalThis.originalRecords = buildWatchlistSimilarityIndex(source, secCapitalIssuers, secCapitalTrades);');
run('updateQueryIndexes(indexes, source, risk); globalThis.preparedRecords = buildWatchlistSimilarityIndex(source, secCapitalIssuers, secCapitalTrades);');
const normalized = rows => JSON.parse(JSON.stringify(rows.map(row => ({ id: row.trade.id, country: row.country, day: row.day, float: row.float, marketCap: row.marketCap, partialMarketCap: row.partialMarketCap }))));
const prepared = normalized(context.preparedRecords), original = normalized(context.originalRecords);
for (let i = 0; i < original.length; i++) assert.deepEqual(prepared[i], original[i], `Prepared similarity differs for ${original[i].id}`);
run('globalThis.preparedR = displayPnlRows(source.trades, "r", risk); queryTradeIndex = null; globalThis.originalR = displayPnlRows(source.trades, "r", risk);');
assert.equal(JSON.stringify(context.preparedR), JSON.stringify(context.originalR), 'Prepared R conversion must equal historical risk calculation');
function snapshot(payload) {
  context.payload = payload;
  return run(`updateIssuerNews(payload, source); JSON.stringify({
    ages: [...tradeNewsAgeIndex].sort(),
    issuers: [...issuerNewsIndex].map(([symbol, item]) => [symbol, item.totalTrades, [...item.reviewedEntries], [...item.articles.keys()], [...item.pending.keys()]]),
    audit: auditNewsCoverage(source)
  })`);
}
assert.equal(snapshot(context.compactNews), snapshot(context.fullNews), 'Compact news index must preserve matching, review and pending counts');
run('updateQueryIndexes(indexes, source, risk)');
assert.equal(run('indexedTickerTrades("BENF", source).length'), context.source.trades.filter(t => t.symbol === 'BENF').length);
run('updateQueryIndexes(indexes, {...source, generatedAt:"stale"}, risk)');
assert.equal(run('queryTradeIndex'), null, 'Stale generated data must be rejected');
async function checkSourceVersions() {
  const manifest = read('data/generated/manifest.json');
  const newsVersion = read('data/news/context-version.json');
  const capitalVersion = read('data/sec/capital-version.json');
  let staleNews = false, staleCapital = false;
  context.fetch = async url => {
    const file = String(url).split('?')[0];
    const payload = file.endsWith('/manifest.json') ? manifest
      : file.endsWith('/context-version.json') ? { ...newsVersion, sha256: staleNews ? 'stale' : newsVersion.sha256 }
      : file.endsWith('/capital-version.json') ? { ...capitalVersion, sha256: staleCapital ? 'stale' : capitalVersion.sha256 }
      : read(file);
    return { ok: true, json: async () => payload };
  };
  run('resetQueryManifest()');
  assert.ok(await run('fetchGenerated("news-index.json")'));
  assert.ok(await run('fetchGenerated("similarity-index.json")'));
  staleNews = true; staleCapital = true;
  run('resetQueryManifest()');
  assert.equal(await run('fetchGenerated("news-index.json")'), null);
  assert.equal(await run('fetchGenerated("similarity-index.json")'), null);
  assert.equal((await run('fetchTradeNews()')).articles.length, context.fullNews.articles.length, 'Stale news falls back to canonical context');
  staleNews = false; staleCapital = false;
  run('resetQueryManifest(); updateIssuerNews(compactNews, source);');
  const symbol = context.compactNews.articles.find(article => article.symbol && context.source.tickerProfiles[article.symbol]).symbol;
  context.testSymbol = symbol;
  const record = run('issuerNewsIndex.get(testSymbol)');
  const original = read(`data/generated/news/tickers/${symbol}.json`);
  assert.ok(record.articles.size > 0);
  let replaced = false;
  const replacement = { querySelector() { return { open: false }; } };
  context.document.createElement = () => ({ set innerHTML(value) {}, content: { querySelector: () => replacement } });
  const detail = { open: true, isConnected: true, dataset: { newsSymbol: symbol }, matches: () => true,
    closest: () => ({ replaceWith() { replaced = true; } }), querySelector: () => ({ textContent: '' }) };
  await handlers.toggle({ target: detail });
  assert.equal(record.detailsLoaded, true);
  assert.equal(replaced, true);
  for (const [id, article] of record.articles) assert.equal(article.summary, original.articles.find(item => item.id === id).summary);
  console.log('Generated index parity, version fallback and lazy news details passed.');
}
checkSourceVersions().catch(error => { console.error(error); process.exitCode = 1; });
