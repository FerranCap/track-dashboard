"""Inventory per-ticker data presence without changing canonical sources."""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROFILE_FIELDS = {
    'issuer': 'issuer_name', 'cik': 'cik',
    'incorporationCountry': 'incorporation_country',
    'incorporationJurisdiction': 'incorporation_jurisdiction',
    'operatingCountry': 'operating_country', 'headquartersCountry': 'headquarters_country',
    'securityType': 'security_type',
}
CAPITAL_FIELDS = {
    'sharesOutstanding': 'sharesOutstanding', 'floatShares': 'floatShares',
    'publicFloatValue': 'publicFloatValue', 'marketCap': 'marketCap',
}
FIELDS = [*PROFILE_FIELDS, *CAPITAL_FIELDS, 'quotedClassValue', 'capitalEvents', 'news', 'prices1m', 'prices1s']
UNKNOWN = {'', 'unknown', 'unverified', 'n/a', 'n/d', 'sin confirmar', 'sin clasificar', '—', '-'}


def assigned(value):
    return isinstance(value, str) and value.strip().lower() not in UNKNOWN


def numeric(value):
    return isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def price_inventory(root):
    available = {'1m': set(), '1s': set()}
    for directory in (root / 'data/research', root / 'data/prices'):
        if not directory.exists():
            continue
        for path in sorted(directory.rglob('*.json')):
            payload = load(path)
            if not isinstance(payload, dict):
                continue
            symbol, interval = payload.get('symbol'), payload.get('interval')
            bars = payload.get('bars')
            if (not isinstance(symbol, str) or not symbol or interval not in available
                    or not isinstance(bars, list) or not bars):
                continue
            if any(isinstance(bar, dict) and isinstance(bar.get('time'), int)
                   and all(price_value(bar.get(key)) for key in ('open', 'high', 'low', 'close'))
                   for bar in bars):
                available[interval].add(symbol)
    return available


def price_value(value):
    try:
        return not isinstance(value, bool) and math.isfinite(float(value)) and float(value) > 0
    except (ValueError, TypeError):
        return False


def build_inventory(dataset, capital, news, prices):
    trades = {trade['id']: trade for trade in dataset['trades']}
    symbols = sorted({trade['symbol'] for trade in trades.values()})
    present = {key: set() for key in FIELDS}
    profiles = dataset.get('tickerProfiles', {})
    for symbol in symbols:
        profile = profiles.get(symbol, {})
        for key, field in PROFILE_FIELDS.items():
            if assigned(profile.get(field)):
                present[key].add(symbol)
        issuer = capital.get('issuers', {}).get(symbol)
        if not issuer or not assigned(str(profile.get('cik') or '')) or str(issuer.get('cik')).lstrip('0') != str(profile['cik']).lstrip('0'):
            continue
        for observation in issuer.get('observations', []):
            if not numeric(observation.get('value')) or observation.get('filingId') not in issuer.get('filings', {}):
                continue
            for key, metric in CAPITAL_FIELDS.items():
                if observation.get('metric') == metric:
                    present[key].add(symbol)
        if any(event.get('description') and event.get('filingId') in issuer.get('filings', {}) for event in issuer.get('events', [])):
            present['capitalEvents'].add(symbol)
    for context in capital.get('trades', []):
        trade = trades.get(context.get('tradeId'))
        estimate = context.get('marketCapEstimate')
        if (not trade or context.get('symbol') != trade['symbol'] or context.get('entryAt') != trade['opened']
                or not estimate or not numeric(estimate.get('value')) or estimate.get('price') != trade.get('entryPrice')):
            continue
        issuer = capital.get('issuers', {}).get(trade['symbol'], {})
        if str(issuer.get('cik')).lstrip('0') != str(profiles.get(trade['symbol'], {}).get('cik')).lstrip('0'):
            continue
        key = {'issuer_common_equity': 'marketCap', 'quoted_class': 'quotedClassValue'}.get(estimate.get('scope'))
        if key:
            present[key].add(trade['symbol'])
    for context in news.get('trades', []):
        trade = trades.get(context.get('tradeId'))
        if not trade or context.get('symbol') != trade['symbol'] or context.get('entryAt') != trade['opened']:
            continue
        if ((context.get('reviewStatus') not in (None, '', 'not_reviewed') and context.get('reviewedOn'))
                or context.get('articles')):
            present['news'].add(trade['symbol'])
    for interval, field in (('1m', 'prices1m'), ('1s', 'prices1s')):
        present[field].update(set(symbols) & prices.get(interval, set()))
    return {
        'schemaVersion': 1,
        'sourceGeneratedAt': dataset.get('generatedAt'),
        'tradeCount': dataset['tradeCount'],
        'symbols': symbols,
        'fields': {key: sorted(values) for key, values in present.items()},
    }


def build():
    dataset = load(ROOT / 'data/trades.json')
    capital = load(ROOT / 'data/sec/trade-capital.json')
    news = load(ROOT / 'data/news/trade-context.json')
    result = build_inventory(dataset, capital, news, price_inventory(ROOT))
    target = ROOT / 'data/reference/data-completeness.json'
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Data completeness: {len(result["symbols"])} tickers, {len(result["fields"])} fields.')


if __name__ == '__main__':
    build()
