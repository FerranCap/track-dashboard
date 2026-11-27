"""Download explicit Databento jobs with cost checks and resumable manifests."""
import math
import os
from pathlib import Path

from update_pipeline import digest, read_json, stamp, utcnow, write_json


def file_hash(path):
    import hashlib
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def uncovered_price_windows(root, job):
    windows = [(stamp(job['start']), stamp(job['end']))]
    manifests = [*(root / 'data/prices/manifests').glob('*.json'),
                 *(root / 'data/prices/tickers').rglob('*.manifest.json')]
    for path in sorted(manifests):
        manifest = read_json(path, {})
        if (manifest.get('type') != 'validated_price_download' or not manifest.get('validatedOHLCV')
                or manifest.get('dataset') != job['dataset'] or manifest.get('schema') != job['schema']
                or not set(job['symbols']) <= set(manifest.get('symbols', []))):
            continue
        normalized = (root / manifest.get('normalizedFile', '')).resolve()
        if not normalized.is_relative_to((root / 'data/prices').resolve()) or not normalized.is_file():
            continue
        if normalized.stat().st_size != manifest.get('normalizedBytes'):
            raise ValueError('Price cache changed; reconcile its manifest before downloading overlapping data.')
        lower, upper = stamp(manifest['start']), stamp(manifest['end'])
        remaining = []
        for start, end in windows:
            if upper <= start or lower >= end:
                remaining.append((start, end))
            else:
                if lower > start:
                    remaining.append((start, lower))
                if upper < end:
                    remaining.append((upper, end))
        windows = remaining
    return windows


def price_download(root, job, maximum_cost, execute=False, client=None, max_records=1000000):
    if not math.isfinite(maximum_cost) or maximum_cost < 0:
        raise ValueError('Price cost ceiling must be finite and nonnegative.')
    if job['domain'] != 'prices' or job['schema'] not in ('ohlcv-1m', 'ohlcv-1s'):
        raise ValueError('Only planned OHLCV price jobs can be downloaded.')
    folder = root / 'data/prices'
    gaps = uncovered_price_windows(root, job)
    if not gaps:
        return {'status': 'already_downloaded', 'jobId': job['id'], 'estimatedCostUsd': 0}
    if client is None:
        if not os.environ.get('DATABENTO_API_KEY'):
            return {'status': 'needs_DATABENTO_API_KEY', 'jobId': job['id']}
        try:
            import databento as db
        except ImportError:
            return {'status': 'needs_databento_sdk', 'jobId': job['id']}
        client = db.Historical(os.environ['DATABENTO_API_KEY'])
    available = client.metadata.get_dataset_range(dataset=job['dataset'])
    coverage = available.get('schema', {}).get(job['schema'], available)
    requested_start, requested_end = gaps[0]
    start = max(requested_start, stamp(coverage['start']))
    end = min(requested_end, stamp(coverage['end']))
    if start >= end:
        return {'status': 'outside_available_range', 'jobId': job['id']}
    if end < requested_end or start > requested_start:
        return {'status': 'window_not_fully_available', 'jobId': job['id'], 'availableStart': start.isoformat(), 'availableEnd': end.isoformat()}
    query = {'dataset': job['dataset'], 'symbols': job['symbols'], 'schema': job['schema'],
             'start': start.isoformat(), 'end': end.isoformat(), 'stype_in': 'raw_symbol'}
    cost = float(client.metadata.get_cost(**query))
    count = int(client.metadata.get_record_count(**query))
    if not math.isfinite(cost) or cost < 0 or count < 0:
        raise ValueError('Provider preflight returned invalid cost or record count.')
    report = {'jobId': job['id'], 'estimatedCostUsd': cost, 'recordCount': count, 'maximumCostUsd': maximum_cost,
              'status': 'quote_only', 'query': query}
    write_json(folder / 'quotes' / f'{job["id"]}.json', report)
    if count > max_records:
        return {**report, 'status': 'record_budget_exceeded'}
    if cost > maximum_cost:
        return {**report, 'status': 'cost_budget_exceeded'}
    if not execute:
        return report
    if count == 0:
        return {**report, 'status': 'no_records_returned_not_assumed_complete'}
    segment_id = job['id'] + '-' + digest([query['start'], query['end']])[:12]
    import re
    if not all(re.fullmatch(r'[A-Za-z0-9._-]+', symbol) for symbol in job['symbols']):
        raise ValueError('Unsafe price storage symbol.')
    scope = '+'.join(sorted(job['symbols']))
    destination = folder / 'tickers' / scope / query['start'][:10] / 'databento' / job['dataset'] / job['schema']
    manifest_path = destination / f'{segment_id}.manifest.json'
    raw = destination / f'{segment_id}.dbn.zst'
    normalized = destination / f'{segment_id}.parquet'
    raw.parent.mkdir(parents=True, exist_ok=True)
    normalized.parent.mkdir(parents=True, exist_ok=True)
    if raw.exists() or normalized.exists():
        return {**report, 'status': 'partial_download_requires_reconciliation'}
    store = client.timeseries.get_range(**query, path=raw)
    # Keep fixed-point prices and instrument metadata in DBN and Parquet.
    store.to_parquet(normalized, price_type='fixed', pretty_ts=True, map_symbols=True, mode='x')
    frame = store.to_df(price_type='fixed', map_symbols=True)
    required = {'open', 'high', 'low', 'close', 'volume', 'symbol'}
    if not required.issubset(frame.columns) or len(frame) != count:
        raise ValueError('Downloaded OHLCV columns or record count do not reconcile.')
    if frame[['open', 'high', 'low', 'close', 'volume']].isna().any().any():
        raise ValueError('Downloaded OHLCV contains missing values.')
    if ((frame['low'] > frame[['open', 'close']].min(axis=1)) | (frame['high'] < frame[['open', 'close']].max(axis=1))
            | (frame['low'] <= 0) | (frame['volume'] < 0)).any():
        raise ValueError('Downloaded OHLCV values do not reconcile.')
    if frame.index.tz is None or frame.index.min() < start or frame.index.max() >= end:
        raise ValueError('Downloaded bar timestamps are outside the requested UTC window.')
    if frame.reset_index().duplicated(subset=['ts_event', 'symbol']).any():
        raise ValueError('Downloaded OHLCV contains duplicate instrument timestamps.')
    observed = sorted(set(str(symbol) for symbol in frame['symbol']))
    if not set(observed) <= set(job['symbols']):
        raise ValueError('Downloaded symbols differ from the planned instruments.')
    manifest = {'schemaVersion': 1, 'type': 'validated_price_download', 'jobId': job['id'],
                'jobFingerprint': job['fingerprint'], 'provider': 'databento', 'dataset': job['dataset'],
                'schema': job['schema'], 'interval': job['schema'].removeprefix('ohlcv-'),
                'symbols': observed, 'requestedSymbols': job['symbols'], 'start': query['start'], 'end': query['end'],
                'downloadedAt': utcnow().isoformat(), 'rowCount': len(frame), 'validatedOHLCV': True,
                'priceBasis': 'provider_fixed_point_unadjusted', 'timezone': 'UTC', 'sessionTimezone': 'America/New_York',
                'rawFile': raw.relative_to(root).as_posix(), 'normalizedFile': normalized.relative_to(root).as_posix(),
                'checksums': {'raw': file_hash(raw), 'normalized': file_hash(normalized)},
                'normalizedBytes': normalized.stat().st_size, 'estimatedCostUsd': cost,
                'limitations': ['Coverage limited to dataset component venues; not assumed full US market coverage.', 'No bars invented for missing intervals; holidays, halts and missing coverage are not inferred from absence.']}
    write_json(manifest_path, manifest)
    return {**report, 'status': 'downloaded', 'remainingSegments': len(gaps) - 1, 'manifest': manifest_path.relative_to(root).as_posix()}
