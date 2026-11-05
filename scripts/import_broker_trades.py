"""Normalize a complete broker session into closed position cycles with an explicit PnL basis."""
import argparse
import csv
import hashlib
import json
import re
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
REQUIRED = {'Symbol', 'Side', 'Price', 'Qty', 'Time', 'P / L', 'ECNFee', 'Cloid'}
FIELDS = ['QuantTradeId', 'TradeOpen', 'TradeClose', 'TradePnL', 'Symbol', 'TradeSide',
          'TradeStatus', 'Date/Time', 'Side', 'Qty', 'Price', 'Commission',
          'ReportedExecutionPnL', 'ECNFee', 'PnLBasis']


def decimal_value(value):
    try:
        result = Decimal(value)
    except (InvalidOperation, TypeError):
        raise ValueError('Missing or invalid numeric value') from None
    if not result.is_finite():
        raise ValueError('Non-finite numeric value')
    return result


def normalize(rows, session_date, pnl_basis):
    if pnl_basis not in ('reported', 'ecn'):
        raise ValueError('Choose reported or ecn PnL basis explicitly')
    day = datetime.strptime(session_date, '%Y-%m-%d').date()
    tz = ZoneInfo('America/New_York')
    parsed = []
    for index, row in enumerate(rows):
        match = re.match(r'^C(\d{6})', row['Cloid'])
        if not match or match[1] != day.strftime('%y%m%d'):
            raise ValueError('Client order date does not match the specified session date')
        stamp = datetime.strptime(f"{session_date} {row['Time']}", '%Y-%m-%d %H:%M:%S').replace(tzinfo=tz)
        side = row['Side'].strip().upper()
        if side not in ('B', 'S', 'SS'):
            raise ValueError(f'Unsupported execution side: {side}')
        qty, price = decimal_value(row['Qty']), decimal_value(row['Price'])
        if qty <= 0 or price <= 0:
            raise ValueError('Execution quantity and price must be positive')
        parsed.append({'symbol': row['Symbol'].strip().upper(), 'side': 'BUY' if side == 'B' else 'SELL',
                       'qty': qty, 'price': price, 'pnl': decimal_value(row['P / L']),
                       'ecn': decimal_value(row['ECNFee']), 'stamp': stamp, 'index': index, 'order': row['Cloid']})
    # The broker export is newest-first; reverse ties to preserve execution order.
    parsed.sort(key=lambda fill: (fill['stamp'], -fill['index']))
    positions, cycles, completed = {}, {}, []
    for fill in parsed:
        symbol = fill['symbol']
        before = positions.get(symbol, Decimal(0))
        change = fill['qty'] if fill['side'] == 'BUY' else -fill['qty']
        if before == 0:
            cycles[symbol] = []
        if before * (before + change) < 0:
            raise ValueError('Position reversal requires explicit splitting; import stopped')
        cycles[symbol].append(fill)
        positions[symbol] = before + change
        if positions[symbol] == 0:
            completed.append(cycles.pop(symbol))
    if any(positions.values()):
        raise ValueError('Session contains open or incomplete positions; import stopped')
    output, summaries = [], []
    identifiers = set()
    for fills in completed:
        first, last = fills[0], fills[-1]
        identity = f"{session_date}|{first['symbol']}|{first['order']}|{first['stamp'].isoformat()}"
        trade_id = 'broker-' + hashlib.sha256(identity.encode()).hexdigest()[:24]
        if trade_id in identifiers:
            raise ValueError('Ambiguous position cycle identity; import stopped')
        identifiers.add(trade_id)
        reported = sum((fill['pnl'] for fill in fills), Decimal(0))
        ecn = sum((fill['ecn'] for fill in fills), Decimal(0))
        pnl = reported + ecn if pnl_basis == 'ecn' else reported
        summaries.append({'id': trade_id, 'symbol': first['symbol'], 'pnl': str(pnl), 'fills': len(fills)})
        for fill in fills:
            output.append(dict(zip(FIELDS, [trade_id, first['stamp'].isoformat(), last['stamp'].isoformat(),
                str(pnl), first['symbol'], first['side'], 'CLOSED', fill['stamp'].isoformat(), fill['side'],
                str(fill['qty']), str(fill['price']), str(-fill['ecn']), str(fill['pnl']), str(fill['ecn']),
                'reported_plus_ecn' if pnl_basis == 'ecn' else 'reported_without_ecn'])))
    return output, summaries


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--date', required=True, help='Verified session date, YYYY-MM-DD; times are New York')
    parser.add_argument('--pnl-basis', required=True, choices=['reported', 'ecn'])
    args = parser.parse_args()
    with args.source.open(encoding='utf-8-sig', newline='') as stream:
        reader = csv.DictReader(stream)
        if not REQUIRED.issubset(reader.fieldnames or []):
            raise ValueError('Unsupported broker CSV columns')
        output, summaries = normalize(list(reader), args.date, args.pnl_basis)
    current = ROOT / 'data/trades.json'
    if current.exists():
        symbols = {row['Symbol'] for row in output}
        for trade in json.loads(current.read_text(encoding='utf-8'))['trades']:
            if trade['date'] == args.date and trade['symbol'] in symbols and not trade['id'].startswith('broker-'):
                raise ValueError('Overlapping Quant trades require reconciliation before broker import')
    target = ROOT / 'data' / f'quant-trades-broker-{args.date}.csv'
    with target.open('w', encoding='utf-8', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(output)
    print(json.dumps({'file': target.name, 'closedTrades': len(summaries), 'executions': len(output),
                      'pnl': str(sum((Decimal(row['pnl']) for row in summaries), Decimal(0))),
                      'pnlBasis': args.pnl_basis, 'trades': summaries}, indent=2))


if __name__ == '__main__':
    main()
