"""Incremental data updates: plan, collect, review, apply and rebuild once."""
import argparse
import contextlib
import csv
import io
import json
import os
import subprocess
import sys
from collections import Counter
from datetime import date
from pathlib import Path

local_dependencies = Path(__file__).resolve().parents[1] / '.cache/python-deps'
if local_dependencies.is_dir():
    sys.path.insert(0, str(local_dependencies))

from build_news import build_context as build_news_context, article_issuers
from build_sec_capital import build_context as build_capital_context
from build_data_completeness import build_inventory, price_inventory
from update_pipeline import (ROOT, NY, SourceCache, active_update_plan, digest, entry_reference, load_inputs, merge_candidate,
                             plan_updates, read_json, scope_update_plan, ticker_review_status,
                             ticker_trade_fingerprint, utcnow, write_json, write_review_packet)
from update_sources import canonical_url, collect_news, collect_sec, matching_entries
from update_prices import price_download, uncovered_price_windows
from query_freshness import write_versioned_json


def current_day():
    return utcnow().astimezone(NY).date().isoformat()


def rebuild(root=ROOT, profiles_changed=False):
    if profiles_changed:
        import build_data
        old_data, old_out = build_data.DATA, build_data.OUT
        try:
            build_data.DATA, build_data.OUT = root / 'data', root / 'data/trades.json'
            with contextlib.redirect_stdout(io.StringIO()):
                build_data.build()
        finally:
            build_data.DATA, build_data.OUT = old_data, old_out
    dataset = read_json(root / 'data/trades.json')
    articles = read_json(root / 'data/news/articles.json')
    research = read_json(root / 'data/news/research.json')
    capital = read_json(root / 'data/sec/capital-history.json')
    symbols = {review['symbol'] for review in research['reviews']} | {issuer['symbol'] for article in articles['articles'] for issuer in article_issuers(article)}
    news_context = build_news_context(dataset, articles['articles'], research['reviews'], symbols, 48)
    capital_context = build_capital_context(capital, dataset)
    completeness = build_inventory(dataset, capital_context, news_context, price_inventory(root))
    write_versioned_json(root / 'data/news/trade-context.json', news_context)
    write_versioned_json(root / 'data/sec/trade-capital.json', capital_context)
    write_json(root / 'data/reference/data-completeness.json', completeness)
    from build_query_data import INPUTS as query_inputs, build as build_query_data
    if all((root / path).is_file() for path in query_inputs):
        build_query_data(root)
    return {'articles': news_context['counts']['articles'], 'tradeArticleLinks': news_context['counts']['tradeArticleLinks']}


def article_from_candidate(candidate, decision, reviewed_on, dataset):
    if decision.get('evidenceHash') != candidate['evidenceHash']:
        raise ValueError('Review is stale: candidate evidence changed.')
    trusted = candidate.get('proposal', {}).get('ready') is True
    if not trusted and (str(decision.get('issuerCik', '')).lstrip('0') != candidate['cik'] or not decision.get('identityEvidence')):
        raise ValueError('News identity needs reviewed CIK and supporting evidence.')
    if not candidate.get('cik'):
        raise ValueError('Issuer identity is unresolved.')
    item = {**candidate, **decision.get('publication', {})}
    precision = item.get('proposal', {}).get('timePrecision', 'day')
    precision = decision.get('timePrecision', precision)
    if precision not in ('day', 'minute', 'second'):
        raise ValueError('Unsupported reviewed timestamp precision.')
    if precision == 'day' and item.get('publishedAt') is not None:
        raise ValueError('Do not discard a known publication timestamp for date fallback.')
    if not item.get('publicationDate'):
        raise ValueError('Publication date must be established.')
    date.fromisoformat(item['publicationDate'])
    active = {trade['id']: trade for trade in dataset['trades']}
    entries = [entry for entry in candidate['entries'] if active.get(entry['id'], {}).get('opened') == entry['opened']
               and active[entry['id']]['symbol'] == entry['symbol']]
    if not matching_entries(item, entries):
        raise ValueError('Publication is outside every candidate trade window.')
    symbols = sorted({entry['symbol'] for entry in matching_entries(item, entries)})
    for symbol in symbols:
        if str(dataset['tickerProfiles'].get(symbol, {}).get('cik', '')).lstrip('0') != candidate['cik']:
            raise ValueError('Reviewed issuer no longer matches the ticker profile.')
    summary = decision.get('summary') or ('Official SEC submissions metadata records this issuer filing. The filing date and existence are established; its contents have not been interpreted.' if trusted else '')
    evidence = decision.get('timestampEvidence') or ('SEC submissions filingDate; no publication hour assigned. EDGAR acceptance clock retained only in collection audit metadata.' if trusted else '')
    if not summary or not evidence:
        raise ValueError('A factual summary and publication evidence are required.')
    article = {
        'id': candidate['id'], 'eventId': decision.get('eventId') or candidate['id'],
        'symbol': symbols[0], 'issuerName': dataset['tickerProfiles'][symbols[0]]['issuer_name'],
        'issuerCik': candidate['cik'], 'headline': item['headline'], 'publishedAt': item.get('publishedAt'),
        'publicationDate': item['publicationDate'], 'timePrecision': precision,
        'publisher': decision.get('publisher') or item.get('publisher'),
        'kind': decision.get('kind') or ('issuer_filing' if trusted else ''),
        'category': decision.get('category') or 'unclassified', 'summary': summary,
        'url': canonical_url(item['sourceUrl']),
        'sourceUrls': sorted({canonical_url(item['sourceUrl']), canonical_url(candidate['receipt']['url']), *decision.get('sourceUrls', [])}),
        'timestampEvidence': evidence, 'verificationStatus': 'verified_date' if precision == 'day' else 'verified_publication',
        'contentAsOfEntryVerified': False, 'checkedOn': reviewed_on,
        'sourceWarnings': decision.get('sourceWarnings') or (['Filing contents have not been reviewed; this publication does not establish a completed transaction or a price cause.'] if trusted else []),
    }
    if not article['kind'] or not article['publisher']:
        raise ValueError('Publisher and publication kind must be reviewed.')
    if len(symbols) > 1:
        article['additionalIssuers'] = [{'symbol': symbol, 'issuerCik': candidate['cik']} for symbol in symbols[1:]]
    return article


def apply_decisions(root, decisions):
    if decisions.get('schemaVersion') != 1 or not decisions.get('reviewer'):
        raise ValueError('Decision schema and reviewer are required.')
    reviewed_on = date.fromisoformat(decisions['reviewedOn']).isoformat()
    inputs = load_inputs(root)
    dataset = inputs['dataset']
    plan = plan_updates(inputs)
    jobs = {job['id']: job for job in plan['jobs']}
    candidates_path = root / 'data/updates/candidates.json'
    candidates = read_json(candidates_path, {})
    articles_path, research_path = root / 'data/news/articles.json', root / 'data/news/research.json'
    articles, research = read_json(articles_path), read_json(research_path)
    capital = inputs['capital']
    profile_path = root / 'data/reference/ticker-profiles.csv'
    overrides_path = root / 'data/reference/ticker-review-overrides.json'
    profile_rows = []
    profile_fields = []
    overrides = read_json(overrides_path, {})
    if profile_path.exists():
        with profile_path.open(encoding='utf-8-sig', newline='') as stream:
            reader = csv.DictReader(stream)
            profile_fields, profile_rows = reader.fieldnames, list(reader)
    updates = {'accepted': 0, 'rejected': 0, 'duplicatePublications': 0, 'reviewedEntries': 0, 'secRecords': 0, 'profileRecords': 0}
    seen_decisions = set()
    for decision in decisions.get('items', []):
        candidate_id = decision['candidateId']
        if candidate_id in seen_decisions:
            raise ValueError('Duplicate candidate decision.')
        seen_decisions.add(candidate_id)
        candidate = candidates.get(candidate_id)
        if not candidate or decision.get('evidenceHash') != candidate['evidenceHash']:
            raise ValueError('Unknown or stale candidate decision.')
        action = decision.get('action')
        if action == 'pending':
            continue
        if action not in ('accept', 'reject'):
            raise ValueError('Unknown review action.')
        if candidate.get('decision') == ('accepted' if action == 'accept' else 'rejected'):
            continue
        if action == 'reject':
            if not decision.get('reason'):
                raise ValueError('Rejected evidence needs a recorded reason.')
            candidate.update(decision='rejected', resolution=decision, reviewedOn=reviewed_on)
            updates['rejected'] += 1
            continue
        if candidate['domain'] == 'news':
            duplicate = decision.get('duplicateOf')
            existing = next((article for article in articles['articles'] if article['id'] == duplicate), None) if duplicate else None
            if duplicate and (not existing or str(existing['issuerCik']).lstrip('0') != candidate['cik']):
                raise ValueError('Duplicate resolution must identify a publication by the same issuer.')
            if existing:
                existing['sourceUrls'] = sorted(set(existing['sourceUrls']) | {canonical_url(candidate['sourceUrl'])})
                updates['duplicatePublications'] += 1
            else:
                article = article_from_candidate(candidate, decision, reviewed_on, dataset)
                existing = next((item for item in articles['articles'] if item['id'] == article['id'] or canonical_url(item['url']) == article['url']), None)
                if existing:
                    if any(existing.get(key) != article.get(key) for key in ('issuerCik', 'publishedAt', 'publicationDate', 'timePrecision')):
                        raise ValueError('Existing publication conflicts with the proposal; resolve it explicitly.')
                    existing['sourceUrls'] = sorted(set(existing['sourceUrls']) | set(article['sourceUrls']))
                    updates['duplicatePublications'] += 1
                else:
                    articles['articles'].append(article)
                    updates['accepted'] += 1
        elif candidate['domain'] == 'sec':
            patch = decision.get('issuerPatch')
            profile_patch = decision.get('profilePatch')
            if profile_patch:
                symbol, fields = profile_patch.get('symbol'), profile_patch.get('fields', {})
                previous = next((row for row in profile_rows if row['symbol'] == symbol), None)
                if (symbol not in candidate['symbols'] or not previous or str(previous['cik']).lstrip('0') != candidate['cik']
                        or decision.get('previousProfileHash') != digest(previous)):
                    raise ValueError('Profile patch must match its reviewed issuer and exact previous profile.')
                if not fields or set(fields) - set(profile_fields) or set(fields) & {'symbol', 'cik'} or any(not isinstance(value, str) for value in fields.values()):
                    raise ValueError('Only existing string profile fields can be patched; identity changes need separate reconciliation.')
                if 'operating_country' in fields and not fields.get('operations_basis'):
                    raise ValueError('Operating-country updates require explicit reviewed operating evidence.')
                previous.update(fields)
                overrides[symbol] = {**overrides.get(symbol, {}), **fields}
                dataset = {**dataset, 'tickerProfiles': {**dataset['tickerProfiles'], symbol: previous}}
                updates['profileRecords'] += 1
                if not patch:
                    candidate.update(decision='accepted', resolution=decision, reviewedOn=reviewed_on)
                    continue
            if not isinstance(patch, dict) or not patch.get('symbol') or patch.get('cik') != candidate['cik']:
                raise ValueError('SEC evidence requires an explicit reviewed canonical issuer patch.')
            symbol = patch['symbol']
            if symbol not in candidate['symbols']:
                raise ValueError('SEC patch symbol is outside the candidate identity.')
            old = capital['issuers'].get(symbol, {})
            if old and decision.get('previousIssuerHash') != digest(old):
                raise ValueError('SEC patch must acknowledge the exact previous issuer record.')
            merged = {**old, **{key: value for key, value in patch.items() if key not in ('symbol', 'filings', 'observations', 'events')}}
            merged['filings'] = {**old.get('filings', {}), **patch.get('filings', {})}
            observations = {item['id']: item for item in old.get('observations', [])}
            for item in patch.get('observations', []):
                if item['id'] in observations and observations[item['id']] != item:
                    raise ValueError('Historical SEC observations cannot be silently overwritten.')
                observations[item['id']] = item
            merged['observations'] = list(observations.values())
            merged['events'] = list(old.get('events', []))
            for event in patch.get('events', []):
                if event not in merged['events']:
                    merged['events'].append(event)
            capital['issuers'][symbol] = merged
            updates['secRecords'] += 1
        candidate.update(decision='accepted', resolution=decision, reviewedOn=reviewed_on)
    for review in decisions.get('jobReviews', []):
        job = jobs.get(review.get('jobId'))
        previous_reviews = [prior for prior in research['reviews'] if prior.get('pipelineJobId') == review.get('jobId')
                            and prior.get('jobFingerprint') == review.get('fingerprint')]
        active_entries = {trade['id']: trade['opened'] for trade in dataset['trades']}
        if not job and previous_reviews and all(active_entries.get(key) == value for prior in previous_reviews for key, value in prior['tradeEntries'].items()):
            continue
        if not job or job['domain'] != 'news' or job['fingerprint'] != review.get('fingerprint'):
            raise ValueError('Review does not match the current exact-entry job.')
        sources = review.get('sources', [])
        if not review.get('windowReviewed') or not sources or not any(source.get('access') in ('reviewed', 'search_index', 'api_archive') for source in sources):
            raise ValueError('Window review requires documented source examination; collection alone is not review.')
        for symbol in job['symbols']:
            refs = {entry['id']: entry['opened'] for entry in job['entries'] if entry['symbol'] == symbol}
            if any(any(prior.get('tradeEntries', {}).get(key) == value for prior in research['reviews']) for key, value in refs.items()):
                raise ValueError('Existing exact-entry reviews must be preserved.')
            research['reviews'].append({'symbol': symbol, 'issuerCik': job['cik'], 'windowHours': 48,
                                        'checkedOn': reviewed_on, 'coverage': 'partial',
                                        'scope': review.get('scope') or 'Incremental review of the exact entry windows in the listed sources.',
                                        'pipelineJobId': job['id'], 'jobFingerprint': job['fingerprint'], 'reviewer': decisions['reviewer'],
                                        'tradeEntries': refs, 'sources': sources, 'unresolvedCandidates': [],
                                        'limitations': review.get('limitations', ['Coverage is limited to the sources examined.'])})
            updates['reviewedEntries'] += len(refs)
    # Validate the complete proposed state before any canonical writes.
    symbols = {review['symbol'] for review in research['reviews']} | {issuer['symbol'] for article in articles['articles'] for issuer in article_issuers(article)}
    context = build_news_context(dataset, articles['articles'], research['reviews'], symbols, 48)
    included = {article['id'] for article in context['articles']}
    if any(article['id'] not in included for article in articles['articles'] if article['id'] in seen_decisions):
        raise ValueError('Accepted publications must serve an actual trade window.')
    build_capital_context(capital, dataset)
    write_json(articles_path, articles)
    write_json(research_path, research)
    write_json(root / 'data/sec/capital-history.json', capital)
    if updates['profileRecords']:
        temporary = profile_path.with_name(profile_path.name + '.tmp')
        with temporary.open('w', encoding='utf-8', newline='') as stream:
            writer = csv.DictWriter(stream, fieldnames=profile_fields)
            writer.writeheader()
            writer.writerows(profile_rows)
        os.replace(temporary, profile_path)
        write_json(overrides_path, overrides)
    write_json(candidates_path, candidates)
    return updates


def collect_batch(root, plan, inputs, domains, limit, refresh=False, max_requests=None, closed_symbols=None):
    folder = root / 'data/updates'
    state = read_json(folder / 'state.json', {'schemaVersion': 1, 'jobs': {}})
    candidates = read_json(folder / 'candidates.json', {})
    config = {**inputs['config']['network']}
    if max_requests is not None:
        config['maxRequests'] = max_requests
    cache = SourceCache(root, config, refresh)
    buckets = {domain: [job for job in plan['jobs'] if job['domain'] == domain
                       and (refresh or state['jobs'].get(job['id'], {}).get('status') not in ('collected', 'source_limited'))]
               for domain in sorted(domains)}
    selected = []
    while len(selected) < limit and any(buckets.values()):
        for domain in ('news', 'sec', 'prices'):
            if buckets.get(domain) and len(selected) < limit:
                selected.append(buckets[domain].pop(0))
    report = {'jobsProcessed': 0, 'newCandidates': 0, 'requests': 0, 'cacheHits': 0, 'modelCalls': 0, 'limitations': []}
    for job in selected:
        if job['domain'] == 'prices':
            state['jobs'][job['id']] = {'status': 'awaiting_price_download', 'reason': 'Use the explicit price-download command with credentials and a cost ceiling.'}
            continue
        try:
            found, receipts = collect_news(job, cache, inputs['config']['news']) if job['domain'] == 'news' else collect_sec(job, cache, inputs['config']['sec'])
            for candidate in found:
                report['newCandidates'] += candidate['id'] not in candidates
                merge_candidate(candidates, candidate)
            access = [receipt['access'] for receipt in receipts]
            usable = any(value in ('cache', 'downloaded', 'legacy_cache') for value in access)
            partial = any(value in ('request_budget_exhausted', 'needs_SEC_USER_AGENT', 'deferred', 'failed', 'source_adapter_required') for value in access)
            status = 'partial_collection' if usable and partial else 'collected' if usable and found and job['domain'] == 'sec' else 'source_limited' if usable else 'deferred'
            state['jobs'][job['id']] = {'status': status,
                                      'collectedAt': utcnow().isoformat(), 'receipts': receipts,
                                      'candidateIds': sorted({candidate['id'] for candidate in found}),
                                      'limitation': 'Discovery does not establish exhaustive historical news coverage or a no-news review.'}
        except (ValueError, KeyError) as error:
            state['jobs'][job['id']] = {'status': 'needs_review', 'failureType': type(error).__name__}
        report['jobsProcessed'] += 1
        write_json(folder / 'candidates.json', candidates)
        write_json(folder / 'state.json', state)
    report.update(requests=cache.requests, cacheHits=cache.hits)
    report['sourceAccess'] = dict(Counter(receipt.get('access') for job in selected for receipt in state['jobs'].get(job['id'], {}).get('receipts', [])))
    report['reviewPacket'] = 'data/updates/review-packet.json'
    packet_candidates = {key: item for key, item in candidates.items()
                         if not set(item.get('symbols', [])) <= (closed_symbols or set())}
    report['reviewItems'] = write_review_packet(root, plan, state, packet_candidates, inputs['config']['review'])
    report['pendingCandidates'] = sum(candidate.get('decision') not in ('accepted', 'rejected') for candidate in candidates.values())
    write_json(folder / 'last-run.json', report)
    write_json(folder / 'state.json', state)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('plan', 'run', 'packet', 'apply', 'rebuild', 'status', 'prices', 'inspect', 'ticker-review'))
    parser.add_argument('--domains', default='news,sec')
    parser.add_argument('--symbols', help='Comma-separated traded tickers, for example AMD,BENF.')
    parser.add_argument('--limit', type=int, default=3)
    parser.add_argument('--max-requests', type=int)
    parser.add_argument('--refresh', action='store_true', help='Explicitly retry collection; successful cached evidence is normally reused.')
    parser.add_argument('--decisions', type=Path)
    parser.add_argument('--job', help='Exact price job ID from queue.json.')
    parser.add_argument('--max-cost-usd', type=float, default=0)
    parser.add_argument('--execute-download', action='store_true', help='Download only after successful provider cost preflight.')
    parser.add_argument('--apply-ready-sec-news', action='store_true', help='Accept verified EDGAR publication metadata only; does not mark entire windows reviewed.')
    parser.add_argument('--check', action='store_true', help='Run the complete test suite once after the batch.')
    parser.add_argument('--review-status', choices=('complete', 'reviewed_limited'))
    parser.add_argument('--note', help='Reviewed coverage or remaining limitations for a ticker.')
    args = parser.parse_args()
    if args.limit < 1 or (args.max_requests is not None and args.max_requests < 0):
        parser.error('Batch limits must be positive; request budget may be zero.')
    domains = set(args.domains.split(','))
    symbols = {symbol.strip().upper() for symbol in args.symbols.split(',') if symbol.strip()} if args.symbols is not None else set()
    if args.symbols is not None and not symbols:
        parser.error('Provide at least one ticker with --symbols.')
    if symbols and args.command in ('apply', 'rebuild'):
        parser.error('Reviewed decision files select their own tickers; rebuild refreshes all derived files.')
    if not domains <= {'news', 'sec', 'prices'}:
        parser.error('Unknown collection domain.')
    folder = ROOT / 'data/updates'
    folder.mkdir(parents=True, exist_ok=True)
    lock = folder / '.lock'
    try:
        descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        parser.error('Another update holds the lock. Inspect it before removing a stale lock.')
    os.write(descriptor, json.dumps({'pid': os.getpid(), 'startedAt': utcnow().isoformat()}).encode())
    os.close(descriptor)
    try:
        inputs = load_inputs()
        baseline = digest([{key: value for key, value in trade.items() if key != 'country'} for trade in inputs['dataset']['trades']])
        plan = plan_updates(inputs)
        write_json(folder / 'queue.json', plan)
        registry_path = folder / 'ticker-reviews.json'
        registry = read_json(registry_path, {'schemaVersion': 1, 'tickers': {}})
        if registry.get('schemaVersion') != 1 or not isinstance(registry.get('tickers'), dict):
            raise ValueError('Invalid ticker review registry.')
        ticker_statuses = ticker_review_status(inputs['dataset'], registry['tickers'])
        closed = set()
        if args.command in ('run', 'packet') and not args.refresh:
            plan, closed = active_update_plan(inputs, registry['tickers'])
        plan = scope_update_plan(plan, symbols, inputs['dataset'])
        report = {'queued': plan['counts'], 'modelCalls': 0}
        if symbols:
            report['symbols'] = sorted(symbols)
        if args.command == 'run':
            report.update(collect_batch(ROOT, plan, inputs, domains, args.limit, args.refresh, args.max_requests, closed))
            if args.apply_ready_sec_news:
                candidates = read_json(folder / 'candidates.json', {})
                items = [{'candidateId': candidate['id'], 'evidenceHash': candidate['evidenceHash'], 'action': 'accept'}
                         for candidate in candidates.values() if candidate.get('proposal', {}).get('ready')
                         and (not symbols or symbols.intersection(candidate['symbols']))
                         and not set(candidate['symbols']) <= closed
                         and candidate.get('decision') not in ('accepted', 'rejected')]
                report['applied'] = apply_decisions(ROOT, {'schemaVersion': 1, 'reviewer': 'deterministic_sec_metadata', 'reviewedOn': current_day(), 'items': items})
                report['rebuilt'] = rebuild(profiles_changed=bool(report['applied']['profileRecords']))
        elif args.command == 'apply':
            if not args.decisions:
                parser.error('Provide --decisions with reviewed decisions.')
            report['applied'] = apply_decisions(ROOT, read_json(args.decisions))
            report['rebuilt'] = rebuild(profiles_changed=bool(report['applied']['profileRecords']))
        elif args.command == 'rebuild':
            report['rebuilt'] = rebuild()
        elif args.command == 'packet':
            candidates = read_json(folder / 'candidates.json', {})
            candidates = {key: item for key, item in candidates.items()
                          if (not symbols or symbols.intersection(item['symbols'])) and not set(item['symbols']) <= closed}
            report['reviewItems'] = write_review_packet(ROOT, plan, read_json(folder / 'state.json', {'jobs': {}}), candidates, inputs['config']['review'])
        elif args.command == 'prices':
            job = next((item for item in plan['jobs'] if item['id'] == args.job and item['domain'] == 'prices'), None)
            if not job:
                parser.error('Provide --job with an exact current price job ID.')
            report['prices'] = price_download(ROOT, job, args.max_cost_usd, args.execute_download)
            if report['prices']['status'] == 'downloaded':
                from build_price_charts import build as build_price_charts
                build_price_charts(ROOT)
                report['rebuilt'] = rebuild()
        elif args.command == 'status':
            report['lastRun'] = read_json(folder / 'last-run.json', {})
            selected = [item for item in ticker_statuses if not symbols or item['symbol'] in symbols]
            report['tickerReviewCounts'] = dict(Counter(item['status'] for item in selected))
            report['tickers'] = selected if symbols else [item for item in selected if item['status'] in ('pending', 'trade_changed')][:10]
            active_plan, _ = active_update_plan(inputs, registry['tickers'])
            report['activeQueued'] = scope_update_plan(active_plan, symbols, inputs['dataset'])['counts']
            report['credentials'] = {'secUserAgentConfigured': bool(os.environ.get('SEC_USER_AGENT')),
                                     'secProjectIdentityFallback': not bool(os.environ.get('SEC_USER_AGENT')),
                                     'databentoKeyConfigured': bool(os.environ.get('DATABENTO_API_KEY'))}
        elif args.command == 'inspect':
            job = next((item for item in plan['jobs'] if item['id'] == args.job), None)
            if not job:
                parser.error('Provide --job with a current exact job ID.')
            report['job'] = job
        elif args.command == 'ticker-review':
            if len(symbols) != 1 or not args.review_status or not (args.note or '').strip():
                parser.error('Provide one --symbols ticker, --review-status and a reviewed --note.')
            symbol = next(iter(symbols))
            related = [job for job in plan['jobs'] if symbol in job['symbols']]
            missing_news = [job['id'] for job in related if job['domain'] == 'news']
            missing_prices = [job['id'] for job in related if job['domain'] == 'prices' and uncovered_price_windows(ROOT, job)]
            if missing_news or missing_prices:
                raise ValueError(f'Cannot close {symbol}: {len(missing_news)} news windows and {len(missing_prices)} price sessions still need review or data.')
            pending_candidates = [candidate['id'] for candidate in read_json(folder / 'candidates.json', {}).values()
                                  if symbol in candidate.get('symbols', []) and candidate.get('decision') not in ('accepted', 'rejected')]
            partial_news = any(review.get('symbol') == symbol and review.get('coverage') != 'complete'
                               for review in inputs['research']['reviews'])
            if args.review_status == 'complete' and (any(job['domain'] == 'sec' for job in related) or pending_candidates or partial_news):
                raise ValueError('Unresolved SEC fields or candidates require reviewed_limited, not complete.')
            record = {'status': args.review_status, 'tradeFingerprint': ticker_trade_fingerprint(inputs['dataset'], symbol),
                      'reviewedOn': current_day(), 'note': args.note.strip(),
                      'pendingCandidates': pending_candidates}
            registry['tickers'][symbol] = record
            write_json(registry_path, registry)
            report['tickerReview'] = {'symbol': symbol, **record}
        current_trades = read_json(ROOT / 'data/trades.json')['trades']
        if digest([{key: value for key, value in trade.items() if key != 'country'} for trade in current_trades]) != baseline:
            raise RuntimeError('Update unexpectedly changed canonical trade accounting.')
        if args.check:
            result = subprocess.run([sys.executable, '-m', 'unittest', 'discover', '-s', 'scripts', '-p', 'test_*.py'], cwd=ROOT, capture_output=True, text=True)
            report['testsPassed'] = result.returncode == 0
            if result.returncode:
                print(result.stdout[-3000:] + result.stderr[-3000:], file=sys.stderr)
                raise RuntimeError('Batch validation failed.')
        print(json.dumps(report, ensure_ascii=False, indent=2))
    finally:
        lock.unlink()


if __name__ == '__main__':
    main()
