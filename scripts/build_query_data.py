"""Build deterministic, independently verifiable website query artifacts."""
import argparse
import hashlib
import json
import math
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
from query_freshness import marker, sync_source_marker, version_path

ROOT = Path(__file__).resolve().parents[1]
NY = ZoneInfo('America/New_York')
INPUTS = ['data/trades.json', 'data/news/trade-context.json', 'data/sec/trade-capital.json',
          'data/session-risk.json', 'data/prices/index.json']


def read(root, name):
    return json.loads((root / name).read_text(encoding='utf-8'))


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode('utf-8')


def instant(value):
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.utcoffset() is None:
        raise ValueError('Trade and filing timestamps require an offset')
    return parsed


def available(filing, opened):
    if filing.get('acceptedAt'):
        return instant(filing['acceptedAt']) < opened
    return bool(filing.get('filedOn') and filing['filedOn'] < opened.astimezone(NY).date().isoformat())


def stats(trades, unit='USD'):
    valid = [t for t in trades if isinstance(t.get('pnl'), (int, float)) and not isinstance(t['pnl'], bool) and math.isfinite(t['pnl'])]
    values = [t['pnl'] for t in valid]
    wins = [t['pnl'] for t in valid if t.get('_classificationPnl', t['pnl']) > 0.000001]
    losses = [t['pnl'] for t in valid if t.get('_classificationPnl', t['pnl']) < -0.000001]
    gross_loss = abs(sum(losses))
    return {'unit': unit, 'trades': len(trades), 'pnl': sum(values), 'wins': len(wins), 'losses': len(losses),
            'scratch': len(values) - len(wins) - len(losses), 'grossWin': sum(wins),
            'grossLoss': gross_loss, 'meanPnl': sum(values) / len(values) if values else None,
            'winRate': len(wins) / len(values) if values else None,
            'bestPnl': max(values) if values else None, 'worstPnl': min(values) if values else None,
            'profitFactor': sum(wins) / gross_loss if gross_loss else None,
            'profitFactorUnbounded': bool(wins and not gross_loss)}


def artifacts(root, cached_manifest=None):
    data, news, capital, risk, prices = [read(root, name) for name in INPUTS]
    cached_manifest = cached_manifest or {}
    dependencies = {}
    algorithm = digest(Path(__file__).read_bytes())

    def cached(name, inputs):
        signature = digest(encode([algorithm, inputs]))
        dependencies[name] = signature
        previous = cached_manifest.get('dependencies', {}).get(name)
        expected_hash = cached_manifest.get('files', {}).get(name)
        path = root / 'data/generated' / name
        if previous != signature or not expected_hash or not path.is_file():
            return None
        raw = path.read_bytes()
        return json.loads(raw) if digest(raw) == expected_hash else None
    trades = data['trades']; profiles = data['tickerProfiles']
    if len({t['id'] for t in trades}) != len(trades):
        raise ValueError('Duplicate trade IDs')
    by_symbol, by_day, trade_rows = defaultdict(list), defaultdict(list), {}
    risk = sorted(risk, key=lambda x: x['effectiveDate'])
    for t in trades:
        opened = instant(t['opened']).astimezone(NY); day = opened.date().isoformat()
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', t['date']):
            raise ValueError('Invalid session date for generated path')
        day_risk = next((x['risk'] for x in reversed(risk) if x['effectiveDate'] <= day), None)
        if not isinstance(day_risk, (int, float)) or isinstance(day_risk, bool) or day_risk <= 0:
            day_risk = None
        trade_rows[t['id']] = {'symbol': t['symbol'], 'opened': t['opened'], 'entryDateNY': day,
                               'entryMinuteNY': opened.hour * 60 + opened.minute,
                               'weekdayNY': opened.weekday(), 'pnlUsd': t.get('pnl'), 'riskUsd': day_risk,
                               'pnlR': t['pnl'] / day_risk if day_risk is not None and isinstance(t.get('pnl'), (int, float)) and not isinstance(t['pnl'], bool) else None}
        by_symbol[t['symbol']].append(t['id']); by_day[t['date']].append(t['id'])
    by_id = {t['id']: t for t in trades}
    ticker_signatures = {symbol: digest(encode([{'trade': by_id[trade_id], 'derived': trade_rows[trade_id]}
                                                for trade_id in ids])) for symbol, ids in by_symbol.items()}
    news_by_symbol = defaultdict(list)
    for row in news['trades']:
        trade = by_id.get(row['tradeId'])
        if not trade or row['symbol'] != trade['symbol'] or row['entryAt'] != trade['opened']:
            raise ValueError('News context does not match trade identity')
        news_by_symbol[row['symbol']].append(row)
    articles = {a['id']: a for a in news['articles']}
    reviews = defaultdict(list)
    for review in news.get('reviews', []): reviews[review['symbol']].append(review)
    capital_by_trade = {c['tradeId']: c for c in capital['trades']}
    generated = {}
    generated['trade-index.json'] = {'schemaVersion': 1, 'sourceGeneratedAt': data.get('generatedAt'),
                                     'riskHistory': risk, 'byTicker': dict(by_symbol), 'byDate': dict(by_day),
                                     'tickerSignatures': ticker_signatures, 'trades': trade_rows}
    # The compact index supports matching; publication details remain per ticker.
    compact_reviews = [{'symbol': r['symbol'], 'unresolvedCandidates': r.get('unresolvedCandidates', [])} for r in news.get('reviews', []) if r.get('unresolvedCandidates')]
    article_index_fields = ('id', 'eventId', 'symbol', 'issuerCik', 'additionalIssuers', 'headline',
                            'publishedAt', 'publicationDate', 'timePrecision', 'publisher', 'kind', 'url', 'verificationStatus')
    compact_articles = [{key: article[key] for key in article_index_fields if key in article} for article in news['articles']]
    generated['news-index.json'] = {**{k: news[k] for k in ('schemaVersion', 'windowHours', 'dateFallbackDays', 'scopedSymbols')},
                                    'sourceGeneratedAt': data.get('generatedAt'), 'deferredDetails': True,
                                    'articles': compact_articles, 'trades': news['trades'], 'reviews': compact_reviews,
                                    'byTrade': {row['tradeId']: row['articles'] for row in news['trades']}}
    ticker_summary = {}; similarity = []
    for symbol, ids in sorted(by_symbol.items()):
        if not re.fullmatch(r'[A-Za-z0-9._-]+', symbol) or symbol in ('.', '..'):
            raise ValueError(f'Unsafe ticker for generated path: {symbol!r}')
        subset = [by_id[i] for i in ids]; profile = profiles.get(symbol, {}); issuer = capital['issuers'].get(symbol)
        matched = news_by_symbol[symbol]; linked_ids = {link['articleId'] for row in matched for link in row['articles']}
        ticker_articles = [a for a in news['articles'] if a['id'] in linked_ids]
        ticker_reviews = reviews[symbol]
        ticker_summary[symbol] = {'tradeCount': len(ids), 'articleCount': len(linked_ids),
                                  'reviewedTrades': sum(row.get('reviewStatus') not in (None, '', 'not_reviewed') and bool(row.get('reviewedOn')) for row in matched)}
        days = sorted({trade_rows[i]['entryDateNY'] for i in ids})
        news_name = f'news/tickers/{symbol}.json'
        news_inputs = {'articles': ticker_articles, 'trades': matched, 'reviews': ticker_reviews}
        generated[news_name] = cached(news_name, news_inputs) or {'schemaVersion': 1, 'symbol': symbol, **news_inputs}
        ticker_name = f'tickers/{symbol}.json'
        ticker_inputs = {'tradeSignature': ticker_signatures[symbol], 'profile': profile, 'capital': issuer,
                         'contexts': [capital_by_trade.get(trade_id) for trade_id in ids], 'news': news_inputs,
                         'priceSessions': prices.get('tickers', {}).get(symbol, {})}
        previous = cached(ticker_name, ticker_inputs)
        if previous is not None:
            generated[ticker_name] = previous
            similarity.extend(previous['similarityRecords'])
            continue
        ticker_similarity = []
        for t in subset:
            opened = instant(t['opened']); day = opened.astimezone(NY).date().isoformat(); float_item = None
            same = issuer and str(issuer.get('cik', '')).lstrip('0') == str(profile.get('cik', '')).lstrip('0') and profile.get('cik')
            if same:
                possible = []
                for item in issuer.get('observations', []):
                    filing = issuer.get('filings', {}).get(item.get('filingId'))
                    if item.get('metric') != 'floatShares' or not isinstance(item.get('value'), (int, float)) or item['value'] <= 0 or item['asOf'] > day or item.get('shareBasisDate', item['asOf']) > day or not filing or not available(filing, opened): continue
                    if issuer.get('quotedShareClass') and item.get('shareClass') != issuer['quotedShareClass']: continue
                    if any(e.get('affectsShareBasis') and item.get('shareBasisDate', item['asOf']) < e['asOf'] <= day and available(issuer['filings'].get(e['filingId'], {}), opened) for e in issuer.get('events', [])): continue
                    possible.append(item)
                if possible: float_item = max(possible, key=lambda x: (x['asOf'], issuer['filings'][x['filingId']]['filedOn']))
            context = capital_by_trade.get(t['id']); estimate = context.get('marketCapEstimate') if context and context.get('entryAt') == t['opened'] and context.get('symbol') == symbol else None
            if estimate and estimate.get('price') != t.get('entryPrice'): estimate = None
            if not same: estimate = None
            ticker_similarity.append({'tradeId': t['id'], 'symbol': symbol, 'opened': t['opened'], 'float': float_item,
                                      'marketCap': estimate if estimate and estimate.get('scope') == 'issuer_common_equity' else None,
                                      'partialMarketCap': estimate if estimate and estimate.get('scope') == 'quoted_class' else None})
        similarity.extend(ticker_similarity)
        r_trades = [{**trade, '_classificationPnl': trade['pnl'], 'pnl': trade_rows[trade['id']]['pnlR']} for trade in subset if trade_rows[trade['id']]['pnlR'] is not None]
        generated[ticker_name] = {'schemaVersion': 1, 'tradeSignature': ticker_signatures[symbol], 'symbol': symbol, 'profile': profile,
            'tradeIds': ids, 'sessions': days, 'statistics': stats(subset),
            'statisticsR': stats(r_trades, 'R'), 'tradesWithoutRisk': len(subset) - len(r_trades),
            'capital': issuer, 'news': {'articles': ticker_articles, 'trades': matched, 'reviews': ticker_reviews},
            'priceSessions': prices.get('tickers', {}).get(symbol, {}), 'similarityRecords': ticker_similarity}
    generated['ticker-summary.json'] = {'schemaVersion': 1, 'tickers': ticker_summary}
    trade_order = {trade['id']: position for position, trade in enumerate(trades)}
    similarity.sort(key=lambda item: trade_order[item['tradeId']])
    generated['similarity-index.json'] = {'schemaVersion': 1, 'sourceGeneratedAt': data.get('generatedAt'), 'records': similarity}
    for day, ids in sorted(by_day.items()):
        subset = [by_id[i] for i in ids]; symbols = sorted({t['symbol'] for t in subset})
        name = f'sessions/{day}.json'
        generated[name] = cached(name, subset) or {'schemaVersion': 1, 'date': day, 'tradeIds': ids, 'statistics': stats(subset),
            'tickers': {symbol: {'tradeIds': [t['id'] for t in subset if t['symbol'] == symbol], 'statistics': stats([t for t in subset if t['symbol'] == symbol])} for symbol in symbols}}
    payloads = {name: encode(value) for name, value in generated.items()}
    manifest = {'schemaVersion': 1, 'inputs': {name: digest((root / name).read_bytes()) for name in INPUTS}, 'dependencies': dependencies,
                'files': {name: digest(value) for name, value in sorted(payloads.items())}}
    payloads['manifest.json'] = encode(manifest)
    return payloads


def build(root=ROOT, check=False):
    target = root / 'data/generated'
    for name in ('data/news/trade-context.json', 'data/sec/trade-capital.json'):
        source = root / name
        if check:
            version = version_path(source)
            if not version.is_file() or version.read_bytes() != marker(source.read_bytes()):
                raise ValueError(f'Source version marker is stale: {name}')
        else:
            sync_source_marker(source)
    old_manifest = read(root, 'data/generated/manifest.json') if (target / 'manifest.json').is_file() else {'files': {}}
    expected = artifacts(root, None if check else old_manifest)
    changed = []
    for name, contents in expected.items():
        path = target / name
        if not path.is_file() or path.read_bytes() != contents:
            changed.append(name)
            if not check:
                path.parent.mkdir(parents=True, exist_ok=True)
                temp = path.with_name(path.name + '.tmp'); temp.write_bytes(contents); temp.replace(path)
    stale = set(old_manifest.get('files', {})) - set(expected)
    for name in sorted(stale):
        path = (target / name).resolve()
        if not path.is_relative_to(target.resolve()): raise ValueError('Invalid generated path')
        if path.is_file():
            changed.append(name)
            if not check: path.unlink()
    if check and changed: raise ValueError(f'Generated artifacts stale: {len(changed)} file(s)')
    return {'files': len(expected), 'changed': len(changed)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--check', action='store_true'); args = parser.parse_args()
    print(json.dumps(build(check=args.check)))
