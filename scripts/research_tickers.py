#!/usr/bin/env python3
"""Collect source-linked SEC issuer evidence without treating an office as an operating country."""
import argparse
import csv
import hashlib
import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.cache' / 'ticker-research'
REFERENCE = ROOT / 'data' / 'reference'
AS_OF = '2026-11-05'
USER_AGENT = os.environ.get('SEC_USER_AGENT', 'TrackDashboardResearch/1.0 (+https://github.com/FerranCap/track-dashboard)')
LOCK = threading.Lock()
LAST_REQUEST = 0.0
US_STATES = set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split())
FIELDS = ['symbol', 'issuer_name', 'cik', 'first_trade_date', 'last_trade_date',
          'incorporation_country', 'incorporation_jurisdiction', 'headquarters_country',
          'operating_country', 'security_type', 'vie_status', 'identity_status',
          'incorporation_status', 'operations_status', 'structure_status', 'review_status',
          'source_profile_url', 'source_filing_url', 'source_filing_date', 'checked_on', 'notes', 'identity_source_url']


class FilingText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'ix:header'):
            self.skip += 1
        if tag in ('p', 'div', 'td', 'tr', 'br', 'h1', 'h2', 'h3'):
            self.parts.append(' ')

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'ix:header'):
            self.skip = max(0, self.skip - 1)

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def fetch(url, json_response=False):
    global LAST_REQUEST
    CACHE.mkdir(parents=True, exist_ok=True)
    target = CACHE / (hashlib.sha256(url.encode()).hexdigest() + ('.json' if json_response else '.html'))
    if target.exists():
        body = target.read_text(encoding='utf-8')
        return json.loads(body) if json_response else body
    with LOCK:
        delay = .3 - (time.monotonic() - LAST_REQUEST)
        if delay > 0:
            time.sleep(delay)
        LAST_REQUEST = time.monotonic()
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept-Encoding': 'identity'})
    with urllib.request.urlopen(request, timeout=40) as response:
        body = response.read().decode('utf-8', errors='replace')
    target.write_text(body, encoding='utf-8')
    return json.loads(body) if json_response else body


def country_name(value):
    aliases = {'Virgin Islands, British': 'British Virgin Islands', 'Korea, Republic of': 'South Korea',
               'Taiwan, Province of China': 'Taiwan', 'China': 'China', 'Hong Kong': 'Hong Kong',
               'United Kingdom': 'United Kingdom', 'USA': 'United States'}
    return aliases.get(value, value or '')


def profile_countries(profile):
    code = profile.get('stateOfIncorporation', '')
    jurisdiction = profile.get('stateOfIncorporationDescription') or code or ''
    incorporation = 'United States' if code in US_STATES else country_name(jurisdiction)
    business = profile.get('addresses', {}).get('business') or {}
    location = business.get('country') or business.get('stateOrCountryDescription') or ''
    headquarters = 'United States' if business.get('stateOrCountry') in US_STATES or location in US_STATES else country_name(location)
    return incorporation, jurisdiction, headquarters


def select_filing(profile):
    recent = profile.get('filings', {}).get('recent', {})
    forms = recent.get('form', [])
    candidates = [i for i, form in enumerate(forms) if form in ('10-K', '20-F', '40-F') and recent['filingDate'][i] <= AS_OF]
    if not candidates:
        candidates = [i for i, form in enumerate(forms) if form in ('20FR12B', '20FR12B/A', 'F-1', 'F-1/A', 'S-1', 'S-1/A') and recent['filingDate'][i] <= AS_OF]
    if not candidates:
        return '', '', ''
    i = candidates[0]
    accession = recent['accessionNumber'][i].replace('-', '')
    document = recent['primaryDocument'][i]
    return f"https://www.sec.gov/Archives/edgar/data/{int(profile['cik'])}/{accession}/{document}", recent['filingDate'][i], forms[i]


def evidence_windows(text):
    patterns = {
        'operations': r'(?:substantially all|all of our|primarily|principal|mainly|majority|predominantly).{0,100}(?:operations|business|revenues|revenue|assets)|(?:operations|business|revenues|revenue|assets).{0,100}(?:primarily|substantially all|mainly|predominantly)|(?:bitcoin mining|headquartered|based in|operat(?:e|es|ing) in)',
        'security': r'American depositary (?:shares|receipts)|Securities registered pursuant to Section 12\(b\)|Trading Symbol',
        'vie': r'variable interest entit|\bVIEs?\b|contractual arrangements',
        'incorporation': r'incorporated (?:in|under)|organized under the laws|jurisdiction of incorporation'
    }
    return {key: [text[max(0, m.start()-130):m.end()+220] for m in list(re.finditer(pattern, text, re.I))[:45]] for key, pattern in patterns.items()}


def collect(symbol, trades, mapping):
    row = dict.fromkeys(FIELDS, '')
    row.update(symbol=symbol, first_trade_date=min(t['date'] for t in trades), last_trade_date=max(t['date'] for t in trades),
               checked_on=AS_OF, vie_status='unknown', security_type='unknown', review_status='needs_review',
               operations_status='unverified', structure_status='unverified', identity_status='unresolved')
    match = mapping.get(symbol)
    if not match:
        row['notes'] = 'No exact match in the current SEC ticker index; historical identity requires research.'
        return row
    cik = int(match['cik_str'])
    row.update(cik=str(cik), issuer_name=match['title'], identity_status=match.get('identity_kind', 'current_ticker_match'),
               identity_source_url=match.get('source_url', 'https://www.sec.gov/files/company_tickers.json'),
               source_profile_url=f'https://data.sec.gov/submissions/CIK{cik:010d}.json')
    try:
        profile = fetch(row['source_profile_url'], True)
        row['issuer_name'] = profile.get('name') or row['issuer_name']
        row['incorporation_country'], row['incorporation_jurisdiction'], row['headquarters_country'] = profile_countries(profile)
        row['incorporation_status'] = 'sec_metadata' if row['incorporation_country'] else 'unverified'
        url, filing_date, form = select_filing(profile)
        row.update(source_filing_url=url, source_filing_date=filing_date)
        if url:
            html = fetch(url)
            parser = FilingText()
            parser.feed(html)
            text = re.sub(r'\s+', ' ', ''.join(parser.parts))
            (CACHE / f'{symbol}-filing.txt').write_text(text, encoding='utf-8')
            windows = evidence_windows(text)
            (CACHE / f'{symbol}-evidence.json').write_text(json.dumps({'form': form, 'url': url, 'windows': windows}, ensure_ascii=False, indent=2), encoding='utf-8')
            row['notes'] = 'SEC incorporation metadata collected; principal operating country and security/VIE structure require filing review. Business address is retained separately.'
        else:
            row['notes'] = 'No annual report or registration statement found in the recent SEC filing list.'
    except Exception as error:
        row['notes'] = f'Source retrieval failed: {type(error).__name__}: {error}'
    return row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--limit', type=int)
    parser.add_argument('--symbols', help='Comma-separated ticker symbols')
    args = parser.parse_args()
    REFERENCE.mkdir(parents=True, exist_ok=True)
    original = CACHE / 'company_tickers.json'
    index = json.loads(original.read_text(encoding='utf-8')) if original.exists() else fetch('https://www.sec.gov/files/company_tickers.json', True)
    mapping = {row['ticker']: row for row in index.values()}
    overrides = REFERENCE / 'ticker-identities.json'
    if overrides.exists():
        mapping.update({symbol: {**record, 'identity_kind': 'historical_ticker_lookup'} for symbol, record in json.loads(overrides.read_text(encoding='utf-8')).items()})
    grouped = defaultdict(list)
    for trade in json.loads((ROOT / 'data/trades.json').read_text(encoding='utf-8'))['trades']:
        grouped[trade['symbol']].append(trade)
    symbols = sorted(grouped)
    if args.symbols:
        symbols = [s for s in symbols if s in args.symbols.split(',')]
    if args.limit:
        symbols = symbols[:args.limit]
    rows = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(collect, symbol, grouped[symbol], mapping): symbol for symbol in symbols}
        for future in as_completed(futures):
            row = future.result()
            rows.append(row)
            with (CACHE / f"{row['symbol']}-record.json").open('w', encoding='utf-8') as stream:
                json.dump(row, stream, ensure_ascii=False, indent=2)
            if len(rows) % 20 == 0 or len(rows) == len(symbols):
                print(f'Collected {len(rows)}/{len(symbols)}; latest: {row["symbol"]}', flush=True)
    if args.symbols or args.limit:
        rows = [json.loads(path.read_text(encoding='utf-8')) for symbol in sorted(grouped)
                if (path := CACHE / f'{symbol}-record.json').exists()]
    target = CACHE / 'ticker-research.csv'
    with target.open('w', encoding='utf-8', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(sorted(rows, key=lambda row: row['symbol']))
    print(f'Wrote {target}: {len(rows)} tickers', flush=True)


if __name__ == '__main__':
    main()
