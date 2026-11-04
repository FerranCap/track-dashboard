#!/usr/bin/env python3
"""Build the public dashboard dataset from Quant trade CSV exports."""
import csv
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
OUT = DATA / 'trades.json'
TZ = ZoneInfo('America/New_York')
REQUIRED = {'QuantTradeId', 'TradeOpen', 'TradeClose', 'TradePnL', 'Symbol', 'TradeSide', 'TradeStatus'}


def parse_datetime(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def numeric(value):
    try:
        return float(value)
    except (ValueError, TypeError):
        return 0.0


def build():
    trades = {}
    sources = []
    unsupported = []
    inconsistent = set()
    total_rows = 0
    for path in sorted(DATA.glob('*.csv')):
        with path.open('r', encoding='utf-8-sig', newline='') as stream:
            reader = csv.DictReader(stream)
            if not reader.fieldnames or not REQUIRED.issubset(set(reader.fieldnames)):
                unsupported.append(path.name)
                continue
            rows = 0
            for row in reader:
                rows += 1
                trade_id = (row.get('QuantTradeId') or '').strip()
                if not trade_id or row.get('TradeStatus', '').strip().upper() != 'CLOSED':
                    continue
                stamp = parse_datetime(row.get('TradeClose')) or parse_datetime(row.get('TradeOpen'))
                if not stamp:
                    continue
                start = parse_datetime(row.get('TradeOpen')) or stamp
                record = {
                    'id': trade_id,
                    'date': stamp.astimezone(TZ).date().isoformat(),
                    'opened': start.astimezone(TZ).isoformat(timespec='seconds'),
                    'closed': stamp.astimezone(TZ).isoformat(timespec='seconds'),
                    'symbol': (row.get('Symbol') or '').strip().upper(),
                    'side': (row.get('TradeSide') or '').strip().upper(),
                    'pnl': round(numeric(row.get('TradePnL')), 4),
                }
                if trade_id in trades:
                    old = trades[trade_id]
                    if old['pnl'] != record['pnl'] or old['symbol'] != record['symbol']:
                        inconsistent.add(trade_id)
                    # Prefer the export containing the most recently closed trade record.
                    if record['closed'] > old['closed']:
                        trades[trade_id] = record
                else:
                    trades[trade_id] = record
        total_rows += rows
        sources.append({'file': path.name, 'rows': rows})

    ordered = sorted(trades.values(), key=lambda r: (r['date'], r['closed'], r['id']))
    payload = {
        'generatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'timezone': 'America/New_York',
        'tradeCount': len(ordered),
        'executionRows': total_rows,
        'sourceFiles': sources,
        'unsupportedFiles': unsupported,
        'inconsistentIds': len(inconsistent),
        'trades': ordered,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    pnl = sum(t['pnl'] for t in ordered)
    years = Counter(t['date'][:4] for t in ordered)
    print(f'Built {OUT}: {len(ordered)} unique trades, {total_rows} execution rows, PnL {pnl:.2f}')
    print(f'Years: {dict(years)}')
    if unsupported:
        print('Skipped incompatible CSV formats:', ', '.join(unsupported))
    if inconsistent:
        print(f'Warning: {len(inconsistent)} trade IDs had conflicting PnL/symbol values across exports')
    return payload


if __name__ == '__main__':
    build()
