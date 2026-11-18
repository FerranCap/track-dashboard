"""Aggregate one New York session from Databento JSONL into minute bars."""
import argparse
import json
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo


def aggregate_session(records, session_date, symbol='NVDA', interval='1m', start_time=None, end_time=None):
    if interval not in ('1m', '1s'):
        raise ValueError('Unsupported bar interval')
    timezone = ZoneInfo('America/New_York')
    if bool(start_time) != bool(end_time):
        raise ValueError('Both session window endpoints are required')
    start = datetime.strptime(start_time, '%H:%M').time() if start_time else None
    end = datetime.strptime(end_time, '%H:%M').time() if end_time else None
    if start and end <= start:
        raise ValueError('Session window end must follow its start')
    buckets = {}
    source_count = 0
    for record in records:
        if record['symbol'] != symbol:
            continue
        timestamp = datetime.fromisoformat(record['hd']['ts_event'].replace('Z', '+00:00'))
        local = timestamp.astimezone(timezone)
        if local.date().isoformat() != session_date:
            continue
        if start and not start <= local.time() < end:
            continue
        minute = timestamp.replace(microsecond=0) if interval == '1s' else timestamp.replace(second=0, microsecond=0)
        prices = [Decimal(record[key]) for key in ('open', 'high', 'low', 'close')]
        volume = int(record['volume'])
        if not all(price.is_finite() and price > 0 for price in prices) or volume < 0:
            raise ValueError('Invalid price or volume')
        opening, high, low, closing = prices
        if low > min(opening, closing) or high < max(opening, closing) or low > high:
            raise ValueError('Invalid OHLC range')
        if minute not in buckets:
            buckets[minute] = dict(first=timestamp, last=timestamp, open=opening,
                                   high=high, low=low, close=closing, volume=volume)
        else:
            bar = buckets[minute]
            bar['high'] = max(bar['high'], high)
            bar['low'] = min(bar['low'], low)
            bar['volume'] += volume
            if timestamp < bar['first']:
                bar['first'], bar['open'] = timestamp, opening
            if timestamp > bar['last']:
                bar['last'], bar['close'] = timestamp, closing
        source_count += 1
    bars = [dict(time=int(minute.timestamp()),
                 **{key: str(bar[key]) for key in ('open', 'high', 'low', 'close')},
                 volume=bar['volume']) for minute, bar in sorted(buckets.items())]
    if not bars:
        raise ValueError('No bars found for the requested session')
    result = dict(symbol=symbol, date=session_date, timezone='America/New_York',
                interval=interval, dataset='XNAS.ITCH', sourceInterval='1s',
                sourceRecordCount=source_count, bars=bars)
    if start:
        result['sessionWindow'] = dict(start=start_time, end=end_time, endExclusive=True)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--date', required=True)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--seconds-output', type=Path)
    parser.add_argument('--seconds-start', help='Inclusive New York time, HH:MM')
    parser.add_argument('--seconds-end', help='Exclusive New York time, HH:MM')
    args = parser.parse_args()
    with args.source.open(encoding='utf-8') as stream:
        result = aggregate_session((json.loads(line) for line in stream if line.strip()), args.date)
    result['sourceFile'] = args.source.name
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f"{result['date']}: {result['sourceRecordCount']} source records, "
          f"{len(result['bars'])} minute bars, volume {sum(bar['volume'] for bar in result['bars'])}")
    if args.seconds_output:
        with args.source.open(encoding='utf-8') as stream:
            seconds = aggregate_session((json.loads(line) for line in stream if line.strip()), args.date,
                                        interval='1s', start_time=args.seconds_start, end_time=args.seconds_end)
        seconds['sourceFile'] = args.source.name
        args.seconds_output.parent.mkdir(parents=True, exist_ok=True)
        args.seconds_output.write_text(json.dumps(seconds, separators=(',', ':')) + '\n', encoding='utf-8')
        print(f"{seconds['date']}: {len(seconds['bars'])} second bars")


if __name__ == '__main__':
    main()
