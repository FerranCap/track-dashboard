"""Build reusable browser price series and audited trade executions offline."""
import argparse
import csv
import hashlib
import json
import re
import shutil
from collections import Counter, defaultdict
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
ZONE = ZoneInfo('America/New_York')
LABELS = {'XNAS.ITCH': 'Nasdaq', 'XNAS.BASIC': 'Nasdaq Basic', 'EQUS.MINI': 'US Equities Mini'}


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')


def safe_path(root, relative):
    path = (root / relative).resolve()
    if not path.is_relative_to((root / 'data/prices').resolve()):
        raise ValueError('Price file escapes its directory.')
    return path


def executions(root, trades):
    from build_data import REQUIRED, parse_datetime, stable_execution
    found = defaultdict(dict)
    for path in sorted((root / 'data').glob('*.csv')):
        with path.open(encoding='utf-8-sig', newline='') as stream:
            reader = csv.DictReader(stream)
            if not REQUIRED.issubset(reader.fieldnames or []):
                continue
            counts = Counter()
            for row in reader:
                trade_id = row.get('QuantTradeId', '').strip()
                if trade_id not in trades:
                    continue
                trade = trades[trade_id]
                if row.get('Symbol', '').strip() != trade['symbol']:
                    raise ValueError('Execution issuer does not match its trade.')
                key = stable_execution(row)
                counts[key] += 1
                timestamp = parse_datetime(row.get('Date/Time'))
                side = row.get('Side', '').strip().upper()
                if timestamp is None or side not in ('BUY', 'SELL'):
                    continue
                qty, price = Decimal(row['Qty']).copy_abs(), Decimal(row['Price'])
                if not qty.is_finite() or not price.is_finite() or qty <= 0 or price <= 0:
                    raise ValueError('Invalid execution price or size.')
                time = int(timestamp.timestamp())
                if not int(datetime.fromisoformat(trade['opened']).timestamp()) <= time <= int(datetime.fromisoformat(trade['closed']).timestamp()):
                    raise ValueError('Execution lies outside the recorded trade.')
                found[trade_id][(key, counts[key])] = {
                    'time': time, 'side': side, 'price': str(price), 'quantity': str(qty),
                    'role': 'entry' if side == trade['side'] else 'exit'}
    result = {}
    for trade_id, trade in trades.items():
        fills = sorted(found[trade_id].values(), key=lambda fill: fill['time'])
        complete = len(fills) == trade['executionCount'] and bool(fills)
        if complete:
            entry = sum(Decimal(f['quantity']) for f in fills if f['role'] == 'entry')
            exit_qty = sum(Decimal(f['quantity']) for f in fills if f['role'] == 'exit')
            if entry != exit_qty or entry != Decimal(str(trade['entryQty'])):
                raise ValueError('Execution quantities do not reconcile with the trade.')
        result[trade_id] = {'opened': trade['opened'], 'closed': trade['closed'],
                            'symbol': trade['symbol'], 'complete': complete, 'fills': fills}
    return result


def validate_series(payload):
    if payload.get('schemaVersion') != 1 or payload.get('interval') != '1m' or not payload.get('bars'):
        raise ValueError('Invalid price chart payload.')
    previous = -1
    for bar in payload['bars']:
        time = bar['time']
        prices = [Decimal(str(bar[key])) for key in ('open', 'high', 'low', 'close')]
        if (not isinstance(time, int) or time % 60 or time <= previous
                or datetime.fromtimestamp(time, ZONE).date().isoformat() != payload['date']
                or not all(value.is_finite() and value > 0 for value in prices)
                or prices[2] > min(prices[0], prices[3]) or prices[1] < max(prices[0], prices[3])
                or prices[2] > prices[1] or not isinstance(bar['volume'], int) or bar['volume'] < 0):
            raise ValueError('Invalid or duplicate chart bar.')
        previous = time


def build(root=ROOT):
    import pandas as pd
    folder = root / 'data/prices'
    manifests = [*folder.glob('manifests/*.json'), *folder.glob('tickers/**/*.manifest.json')]
    grouped = defaultdict(dict)
    for path in sorted(manifests):
        manifest = read(path)
        if not manifest.get('validatedOHLCV') or manifest.get('schema') != 'ohlcv-1m':
            continue
        parquet = safe_path(root, manifest['normalizedFile'])
        if hashlib.sha256(parquet.read_bytes()).hexdigest() != manifest['checksums']['normalized']:
            raise ValueError('Parquet checksum differs from its validated manifest.')
        frame = pd.read_parquet(parquet).reset_index()
        if len(frame) != manifest['rowCount']:
            raise ValueError('Parquet row count differs from its manifest.')
        for row in frame.to_dict('records'):
            time = int(pd.Timestamp(row['ts_event']).timestamp())
            date = datetime.fromtimestamp(time, ZONE).date().isoformat()
            symbol = row['symbol']
            if not re.fullmatch(r'[A-Za-z0-9._-]+', symbol):
                raise ValueError('Unsafe price symbol.')
            key = symbol, date, manifest['provider'], manifest['dataset']
            bar = {'time': time, **{name: format(Decimal(int(row[name])) / Decimal(10**9), 'f')
                                    for name in ('open', 'high', 'low', 'close')}, 'volume': int(row['volume'])}
            if time in grouped[key] and grouped[key][time] != bar:
                raise ValueError('Conflicting overlapping bars within one source.')
            grouped[key][time] = bar
    data = read(root / 'data/trades.json')
    available = {(symbol, date) for symbol, date, _, _ in grouped}
    trades = {t['id']: t for t in data['trades']
              if (t['symbol'], datetime.fromisoformat(t['opened']).astimezone(ZONE).date().isoformat()) in available}
    fills = executions(root, trades)
    index = {'schemaVersion': 1, 'interval': '1m', 'timezone': 'America/New_York', 'tickers': {}}
    for key, values in sorted(grouped.items()):
        symbol, date, provider, dataset = key
        payload = {'schemaVersion': 1, 'symbol': symbol, 'date': date, 'provider': provider,
                   'dataset': dataset, 'interval': '1m', 'timezone': 'America/New_York',
                   'priceBasis': 'unadjusted', 'bars': sorted(values.values(), key=lambda bar: bar['time'])}
        validate_series(payload)
        relative = f'data/prices/tickers/{symbol}/{date}/{provider}/{dataset}/ohlcv-1m/chart.json'
        write(safe_path(root, relative), payload)
        session = index['tickers'].setdefault(symbol, {}).setdefault(date, {'sources': []})
        session['sources'].append({'id': f'{provider}:{dataset}', 'dataset': dataset, 'provider': provider,
                                   'label': LABELS.get(dataset, dataset), 'file': relative,
                                   'barCount': len(payload['bars'])})
    for symbol, sessions in index['tickers'].items():
        for date, session in sessions.items():
            relative = f'data/prices/tickers/{symbol}/{date}/executions.json'
            session_fills = {trade_id: entry for trade_id, entry in fills.items()
                             if entry['symbol'] == symbol and datetime.fromisoformat(entry['opened']).astimezone(ZONE).date().isoformat() == date}
            write(safe_path(root, relative), {'schemaVersion': 1, 'symbol': symbol, 'date': date, 'trades': session_fills})
            session['executionsFile'] = relative
    write(folder / 'index.json', index)
    return index


def check(root=ROOT, destination=None):
    index = read(root / 'data/prices/index.json')
    if index.get('schemaVersion') != 1 or index.get('interval') != '1m':
        raise ValueError('Invalid price index.')
    paths = {'data/prices/index.json'}
    for symbol, sessions in index['tickers'].items():
        for date, session in sessions.items():
            if len({source['id'] for source in session['sources']}) != len(session['sources']):
                raise ValueError('Duplicate price sources.')
            for source in session['sources']:
                payload = read(safe_path(root, source['file']))
                validate_series(payload)
                if (payload['symbol'], payload['date'], payload['dataset'], len(payload['bars'])) != (symbol, date, source['dataset'], source['barCount']):
                    raise ValueError('Chart payload does not match its index.')
                paths.add(source['file'])
            payload = read(safe_path(root, session['executionsFile']))
            if payload['symbol'] != symbol or payload['date'] != date:
                raise ValueError('Execution payload does not match its index.')
            paths.add(session['executionsFile'])
    if destination:
        for relative in sorted(paths):
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(root / relative, target)
    return len(paths)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--package', type=Path)
    args = parser.parse_args()
    if not args.check and not args.package:
        build()
    print(f'Price chart files verified: {check(destination=args.package)}')
