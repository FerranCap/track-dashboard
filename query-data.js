'use strict';

let queryManifestRequest = null;
let queryVersionsRequest = null;
let queryTradeIndex = null;
let querySimilarityIndex = null;
let queryTradesById = new Map();

function resetQueryManifest() {
  queryManifestRequest = null;
  queryVersionsRequest = null;
}

function queryManifest() {
  if (!queryManifestRequest) {
    queryManifestRequest = fetch('data/generated/manifest.json', { cache: 'no-cache' })
      .then(response => response.ok ? response.json() : null)
      .catch(() => null);
  }
  return queryManifestRequest;
}

function queryVersions() {
  if (!queryVersionsRequest) {
    queryVersionsRequest = Promise.all(['data/news/context-version.json', 'data/sec/capital-version.json'].map(async path => {
      try {
        const response = await fetch(path, { cache: 'no-cache' });
        return response.ok ? await response.json() : null;
      } catch { return null; }
    }));
  }
  return queryVersionsRequest;
}

async function fetchGenerated(name) {
  try {
    const manifest = await queryManifest();
    const hash = manifest?.schemaVersion === 1 && manifest.files?.[name];
    if (!/^[a-f0-9]{64}$/.test(hash || '') || !/^[A-Za-z0-9._/-]+$/.test(name) || name.split('/').includes('..')) return null;
    if (name === 'news-index.json' || name.startsWith('news/tickers/') || name === 'similarity-index.json') {
      const [newsVersion, capitalVersion] = await queryVersions();
      if ((name === 'news-index.json' || name.startsWith('news/tickers/')) && (newsVersion?.schemaVersion !== 1 || newsVersion.sha256 !== manifest.inputs?.['data/news/trade-context.json'])) return null;
      if (name === 'similarity-index.json' && (capitalVersion?.schemaVersion !== 1 || capitalVersion.sha256 !== manifest.inputs?.['data/sec/trade-capital.json'])) return null;
    }
    const response = await fetch(`data/generated/${name}?v=${hash}`);
    return response.ok ? await response.json() : null;
  } catch (error) {
    console.warn('Generated data unavailable:', error);
    return null;
  }
}

async function fetchQueryIndexes() {
  const [trades, similarity] = await Promise.all([fetchGenerated('trade-index.json'), fetchGenerated('similarity-index.json')]);
  return { trades, similarity };
}

function updateQueryIndexes(payload, source, history) {
  queryTradeIndex = null;
  querySimilarityIndex = null;
  queryTradesById = new Map(source.trades.map(trade => [trade.id, trade]));
  const index = payload?.trades;
  if (index?.schemaVersion !== 1 || index.sourceGeneratedAt !== source.generatedAt || !index.byTicker || !index.byDate || !index.trades || JSON.stringify(index.riskHistory) !== JSON.stringify(history)) return;
  if (Object.keys(index.trades).length !== source.trades.length || source.trades.some(trade => index.trades[trade.id]?.opened !== trade.opened || index.trades[trade.id]?.symbol !== trade.symbol || index.trades[trade.id]?.pnlUsd !== trade.pnl)) return;
  queryTradeIndex = index;
  const similarity = payload.similarity;
  if (similarity?.schemaVersion === 1 && similarity.sourceGeneratedAt === source.generatedAt && Array.isArray(similarity.records) && similarity.records.length === source.trades.length && similarity.records.every(row => queryTradesById.get(row.tradeId)?.opened === row.opened && queryTradesById.get(row.tradeId)?.symbol === row.symbol)) querySimilarityIndex = similarity;
}

function indexedTickerTrades(symbol, source) {
  if (!queryTradeIndex || !Array.isArray(queryTradeIndex.byTicker[symbol])) return source.trades.filter(trade => trade.symbol.toUpperCase() === symbol.toUpperCase());
  const rows = queryTradeIndex.byTicker[symbol].map(id => queryTradesById.get(id));
  return rows.every(trade => trade && trade.symbol === symbol) ? rows : source.trades.filter(trade => trade.symbol.toUpperCase() === symbol.toUpperCase());
}
