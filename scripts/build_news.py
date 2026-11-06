"""Link reviewed news to entry windows without changing trade accounting."""
import argparse
import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def timestamp(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.utcoffset() is None:
        raise ValueError('News and entry timestamps require an explicit UTC offset')
    return result.astimezone(timezone.utc)


def build_context(dataset, articles, reviews, symbols, hours=48):
    if not isinstance(hours, int) or hours <= 0:
        raise ValueError('The entry lookback must be a positive whole number of hours')
    trades = [trade for trade in dataset['trades'] if trade['symbol'] in symbols]
    if len({trade['id'] for trade in trades}) != len(trades):
        raise ValueError('Duplicate trade IDs')
    trade_ids = {trade['id'] for trade in trades}
    profiles = dataset.get('tickerProfiles', {})
    selected = [article for article in articles if article['symbol'] in symbols]
    if len({article['id'] for article in selected}) != len(selected):
        raise ValueError('Duplicate news IDs')
    urls = set()
    parsed = []
    for article in selected:
        if article['url'] in urls:
            raise ValueError('Duplicate canonical news URL; merge syndications first')
        urls.add(article['url'])
        profile_cik = profiles.get(article['symbol'], {}).get('cik')
        if not profile_cik or int(profile_cik) != int(article['issuerCik']):
            raise ValueError('News issuer does not match the reviewed ticker profile')
        start = timestamp(article['publishedAt'])
        precision = article['timePrecision']
        if precision not in ('second', 'minute'):
            raise ValueError('Uncertain dates belong in the review log, not confirmed news')
        if precision == 'minute' and (start.second or start.microsecond):
            raise ValueError('Minute-precision publication must start on a minute boundary')
        if article['verificationStatus'] != 'verified_publication':
            raise ValueError('Unverified publications belong in the research log')
        if not article.get('timestampEvidence') or not article.get('sourceUrls'):
            raise ValueError('Publication timestamp evidence is required')
        end = start + timedelta(minutes=1) if precision == 'minute' else start
        parsed.append((article, start, end))
    parsed.sort(key=lambda item: (item[1], item[0]['id']))
    context, included = [], set()
    for trade in sorted(trades, key=lambda item: (timestamp(item['opened']), item['id'])):
        entry = timestamp(trade['opened'])
        lower = entry - timedelta(hours=hours)
        matched, uncertain = [], []
        for article, start, end in parsed:
            if article['symbol'] != trade['symbol']:
                continue
            if start >= lower and start < entry and end <= entry:
                matched.append({'articleId': article['id'], 'eventId': article['eventId'],
                                'ageSecondsMin': (entry - end).total_seconds(),
                                'ageSecondsMax': (entry - start).total_seconds()})
                included.add(article['id'])
            elif start < entry and end > lower:
                uncertain.append(article['id'])
                included.add(article['id'])
        review = next((review for review in reviews if review['symbol'] == trade['symbol']
                       and review['windowHours'] >= hours
                       and review.get('tradeEntries', {}).get(trade['id']) == trade['opened']), None)
        pending = [candidate for candidate in (review or {}).get('unresolvedCandidates', [])
                   if trade['id'] in candidate['candidateTradeIds']]
        status = 'news_found' if matched else 'pending_verification' if uncertain or pending or not review else 'none_found_in_reviewed_sources'
        context.append({'tradeId': trade['id'], 'symbol': trade['symbol'], 'entryAt': trade['opened'],
                        'windowStartAt': lower.isoformat(), 'windowEndAt': entry.isoformat(),
                        'status': status, 'reviewStatus': review['coverage'] if review else 'not_reviewed',
                        'reviewedOn': review['checkedOn'] if review else None,
                        'articles': matched, 'eventCount': len({item['eventId'] for item in matched}),
                        'uncertainArticleIds': uncertain,
                        'unresolvedCandidateIds': [candidate['id'] for candidate in pending]})
    accounting = json.dumps(dataset['trades'], sort_keys=True).encode()
    return {'schemaVersion': 1, 'windowHours': hours, 'windowRule': 'entry_minus_hours_inclusive_to_entry_exclusive',
            'timezone': 'America/New_York', 'scopedSymbols': sorted(symbols),
            'tradeAccountingSha256': hashlib.sha256(accounting).hexdigest(),
            'articles': [article for article, _, _ in parsed if article['id'] in included],
            'trades': context,
            'reviews': [{**review, 'tradeEntries': {key: value for key, value in review['tradeEntries'].items() if key in trade_ids}}
                        for review in reviews if review['symbol'] in symbols],
            'counts': {'trades': len(context), 'articles': len(included),
                       'events': len({article['eventId'] for article, _, _ in parsed if article['id'] in included}),
                       'tradeArticleLinks': sum(len(item['articles']) for item in context),
                       'tradesWithNews': sum(item['status'] == 'news_found' for item in context)}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--symbols', default='VIVK', help='Comma-separated pilot tickers')
    parser.add_argument('--hours', type=int, default=48)
    args = parser.parse_args()
    folder = ROOT / 'data' / 'news'
    read = lambda path: json.loads(path.read_text(encoding='utf-8'))
    dataset = read(ROOT / 'data' / 'trades.json')
    result = build_context(dataset, read(folder / 'articles.json')['articles'],
                           read(folder / 'research.json')['reviews'],
                           {symbol.strip().upper() for symbol in args.symbols.split(',') if symbol.strip()}, args.hours)
    (folder / 'trade-context.json').write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(json.dumps(result['counts'], indent=2))


if __name__ == '__main__':
    main()
