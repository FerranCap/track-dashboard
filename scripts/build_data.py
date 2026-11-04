#!/usr/bin/env python3
"""Consolidate overlapping Quant CSV exports into auditable trade records."""
import csv
import json
from collections import Counter, defaultdict
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
        dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def numeric(value):
    try:
        return float(value)
    except (ValueError, TypeError):
        return 0.0


def stable_execution(row):
    """Identify export-overlapping fills without merging repeated fills in one export."""
    keys = ('Date/Time', 'Symbol', 'Side', 'Qty', 'Price', 'Commission', 'QuantTradeId')
    return tuple((row.get(key) or '').strip() for key in keys)


def build():
    trades = {}
    executions = defaultdict(dict)
    sources = []
    unsupported = []
    inconsistencies = set()
    total_rows = 0

    for path in sorted(DATA.glob('*.csv')):
        with path.open('r', encoding='utf-8-sig', newline='') as stream:
            reader = csv.DictReader(stream)
            if not reader.fieldnames or not REQUIRED.issubset(set(reader.fieldnames)):
                unsupported.append(path.name)
                continue
            counts = Counter()
            row_count = 0
            for row in reader:
                row_count += 1
                trade_id = (row.get('QuantTradeId') or '').strip()
                if not trade_id or (row.get('TradeStatus') or '').strip().upper() != 'CLOSED':
                    continue
                closed = parse_datetime(row.get('TradeClose')) or parse_datetime(row.get('TradeOpen'))
                opened = parse_datetime(row.get('TradeOpen')) or closed
                if closed is None or opened is None:
                    continue
                side = (row.get('TradeSide') or '').strip().upper()
                record = {
                    'id': trade_id,
                    'date': closed.astimezone(TZ).date().isoformat(),
                    'opened': opened.astimezone(TZ).isoformat(timespec='seconds'),
                    'closed': closed.astimezone(TZ).isoformat(timespec='seconds'),
                    'symbol': (row.get('Symbol') or '').strip().upper(),
                    'side': side,
                    'pnl': round(numeric(row.get('TradePnL')), 6),
                }
                old = trades.get(trade_id)
                if old is not None:
                    if old['pnl'] != record['pnl'] or old['symbol'] != record['symbol'] or old['side'] != side:
                        inconsistencies.add(trade_id)
                    if record['closed'] > old['closed']:
                        trades[trade_id] = record
                else:
                    trades[trade_id] = record

                fill_key = stable_execution(row)
                counts[fill_key] += 1
                occurrence = counts[fill_key]
                # The occurrence index preserves truly repeated executions within each export.
                unique_key = (fill_key, occurrence)
                executions[trade_id][unique_key] = {
                    'side': (row.get('Side') or '').strip().upper(),
                    'qty': abs(numeric(row.get('Qty'))),
                    'price': numeric(row.get('Price')),
                    'commission': numeric(row.get('Commission')),
                }
            total_rows += row_count
            sources.append({'file': path.name, 'rows': row_count})

    for trade_id, record in trades.items():
        fills = list(executions[trade_id].values())
        entry_fills = [fill for fill in fills if fill['side'] == record['side']]
        entry_qty = sum(fill['qty'] for fill in entry_fills)
        record['entryPrice'] = round(
            sum(fill['price'] * fill['qty'] for fill in entry_fills) / entry_qty, 6
        ) if entry_qty else None
        record['entryQty'] = round(entry_qty, 6) if entry_qty else None
        record['fees'] = round(sum(fill['commission'] for fill in fills), 6)
        record['executionCount'] = len(fills)
        opening = datetime.fromisoformat(record['opened'])
        closing = datetime.fromisoformat(record['closed'])
        record['holdMinutes'] = round(max(0, (closing - opening).total_seconds()) / 60, 4)
        # Historical MAE/MFE requires intratrade price movement, which these fills do not contain.
        record['mae'] = None
        record['mfe'] = None

    ordered = sorted(trades.values(), key=lambda trade: (trade['closed'], trade['id']))
    payload = {
        'schemaVersion': 2,
        'generatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'timezone': 'America/New_York',
        'tradeCount': len(ordered),
        'executionRows': total_rows,
        'uniqueExecutionRows': sum(len(fills) for fills in executions.values()),
        'sourceFiles': sources,
        'unsupportedFiles': unsupported,
        'inconsistentIds': len(inconsistencies),
        'dataNotes': [
            'TradePnL comes from QuantTradeId and is not adjusted for fees again.',
            'Fees are the sum of unique fill commissions across overlapping exports.',
            'MAE and MFE are unavailable without intratrade market prices.',
            'Trades.csv (broker-specific format) is excluded from Quant statistics.'
        ],
        'trades': ordered,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f"Created {OUT}: {len(ordered)} trades, PnL {sum(t['pnl'] for t in ordered):.2f}")
    print(f"Execution rows: {total_rows}, unique fills: {payload['uniqueExecutionRows']}")
    if unsupported:
        print('Excluded incompatible CSV formats:', ', '.join(unsupported))
    if inconsistencies:
        print('Conflicting trade IDs:', len(inconsistencies))
    return payload


if __name__ == '__main__':
    build()
