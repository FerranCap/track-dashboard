"""Validate reviewed SEC capital history and build entry-time reference estimates."""
import json
import math
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo
from query_freshness import write_versioned_json

ROOT = Path(__file__).resolve().parents[1]
NY = ZoneInfo('America/New_York')
METRICS = {
    'sharesOutstanding': 'shares', 'floatShares': 'shares',
    'publicFloatValue': 'USD', 'marketCap': 'USD', 'netAssets': 'USD',
}


def positive(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0


def validate(history, dataset):
    if history.get('schemaVersion') != 1 or not isinstance(history.get('issuers'), dict):
        raise ValueError('Unsupported SEC capital history schema.')
    for symbol, issuer in history['issuers'].items():
        profile = dataset['tickerProfiles'].get(symbol)
        if not profile or str(profile['cik']).lstrip('0') != str(issuer['cik']).lstrip('0'):
            raise ValueError(f'{symbol}: issuer CIK does not match the reviewed profile.')
        if issuer.get('coverage') not in ('partial', 'reviewed'):
            raise ValueError(f'{symbol}: coverage must be explicit.')
        date.fromisoformat(issuer['reviewedOn'])
        filings = issuer['filings']
        if issuer.get('marketCapMethod') == 'quoted_class_only' and not issuer.get('quotedShareClass'):
            raise ValueError(f'{symbol}: quoted-class estimates require an explicit class.')
        for key, filing in filings.items():
            date.fromisoformat(filing['filedOn'])
            url = urlparse(filing['url'])
            index = urlparse(filing['indexUrl'])
            if any(u.scheme != 'https' or u.hostname != 'www.sec.gov' or not u.path.startswith('/Archives/edgar/data/') for u in (url, index)):
                raise ValueError(f'{symbol}/{key}: SEC archive evidence required.')
            if not filing.get('form') or not filing.get('accession'):
                raise ValueError(f'{symbol}/{key}: filing identity required.')
            archive = f'/Archives/edgar/data/{str(issuer["cik"]).lstrip("0")}/{filing["accession"].replace("-", "")}/'
            if any(not u.path.startswith(archive) for u in (url, index)):
                raise ValueError(f'{symbol}/{key}: filing URL must match its issuer and accession.')
            if filing.get('acceptedAt'):
                stamp = datetime.fromisoformat(filing['acceptedAt'])
                if stamp.tzinfo is None:
                    raise ValueError('Acceptance timestamps require a timezone.')
        ids = set()
        for item in issuer['observations']:
            if item['id'] in ids:
                raise ValueError(f'{symbol}: duplicate observation ID.')
            ids.add(item['id'])
            date.fromisoformat(item['asOf'])
            if item['asOf'] > filings.get(item['filingId'], {}).get('filedOn', ''):
                raise ValueError(f'{symbol}: observation date follows its filing or filing is missing.')
            if item['metric'] not in METRICS or item['unit'] != METRICS[item['metric']]:
                raise ValueError(f'{symbol}: incorrect metric unit.')
            if item['value'] is not None and not positive(item['value']):
                raise ValueError(f'{symbol}: capital values must be positive or null.')
            if item['filingId'] not in filings or not item.get('evidence'):
                raise ValueError(f'{symbol}: observation evidence required.')
            if item['basis'] not in ('reported', 'estimated'):
                raise ValueError(f'{symbol}: observation basis required.')
            if item['basis'] == 'estimated':
                calc = item.get('calculation', {})
                if (item['metric'] != 'floatShares' or not positive(calc.get('publicFloatValue'))
                        or not positive(calc.get('price'))
                        or not positive(item['value'])
                        or not math.isclose(item['value'], calc['publicFloatValue'] / calc['price'], rel_tol=1e-12)):
                    raise ValueError(f'{symbol}: float estimate must reconcile to its inputs.')
        for event in issuer.get('events', []):
            date.fromisoformat(event['asOf'])
            if event['filingId'] not in filings or not event.get('description'):
                raise ValueError(f'{symbol}: event evidence required.')


def available_before(filing, opened):
    """Exclude date-only filings on entry day when publication order is unknown."""
    if filing.get('acceptedAt'):
        return datetime.fromisoformat(filing['acceptedAt']) < opened
    return date.fromisoformat(filing['filedOn']) < opened.astimezone(NY).date()


def build_context(history, dataset):
    validate(history, dataset)
    contexts = []
    for trade in dataset['trades']:
        issuer = history['issuers'].get(trade['symbol'])
        if not issuer:
            continue
        opened = datetime.fromisoformat(trade['opened'])
        day = opened.astimezone(NY).date().isoformat()
        eligible = [item for item in issuer['observations']
                    if item['asOf'] <= day and available_before(issuer['filings'][item['filingId']], opened)]
        shares = [item for item in eligible if item['metric'] == 'sharesOutstanding' and positive(item['value'])
                  and (not issuer.get('quotedShareClass') or item.get('shareClass') == issuer['quotedShareClass'])]
        latest = max(shares, key=lambda item: (item['asOf'], issuer['filings'][item['filingId']]['filedOn']), default=None)
        estimate = None
        reason = 'no_available_share_count'
        if issuer['securityType'] == 'ETF':
            reason = 'etf_creations_redemptions_not_reconciled'
        elif latest and issuer.get('marketCapMethod') in ('single_common_class', 'quoted_class_only'):
            blocked = any(event.get('affectsShareBasis') and latest['asOf'] < event['asOf'] <= day
                          and available_before(issuer['filings'][event['filingId']], opened)
                          for event in issuer.get('events', []))
            if blocked:
                reason = 'unreconciled_share_basis_change'
            elif positive(trade.get('entryPrice')):
                estimate = {
                    'value': latest['value'] * trade['entryPrice'], 'unit': 'USD',
                    'basis': 'estimated', 'sharesObservationId': latest['id'],
                    'scope': 'quoted_class' if issuer['marketCapMethod'] == 'quoted_class_only' else 'issuer_common_equity',
                    'shareClass': latest.get('shareClass'),
                    'sharesAsOf': latest['asOf'], 'shares': latest['value'],
                    'price': trade['entryPrice'], 'priceBasis': 'trade_average_entry_price',
                    'shareCountAgeDays': (date.fromisoformat(day) - date.fromisoformat(latest['asOf'])).days,
                    'limitation': 'Last reviewed published share count multiplied by the trade average entry price. Changes between the share date and entry are not fully reconciled; this is not an exact historical market cap.',
                }
                reason = None
            else:
                reason = 'entry_price_missing'
        elif latest:
            reason = 'security_class_or_ads_basis_not_reconciled'
        contexts.append({'tradeId': trade['id'], 'symbol': trade['symbol'], 'entryAt': trade['opened'],
                         'sharesObservationId': latest['id'] if latest else None,
                         'marketCapEstimate': estimate, 'unavailableReason': reason})
    return {'schemaVersion': 1, 'issuers': history['issuers'], 'trades': contexts}


def build():
    history = json.loads((ROOT / 'data/sec/capital-history.json').read_text(encoding='utf-8'))
    dataset = json.loads((ROOT / 'data/trades.json').read_text(encoding='utf-8'))
    result = build_context(history, dataset)
    target = ROOT / 'data/sec/trade-capital.json'
    write_versioned_json(target, result)
    print(f'SEC capital: {len(result["issuers"])} issuers, {len(result["trades"])} trade references.')


if __name__ == '__main__':
    build()
