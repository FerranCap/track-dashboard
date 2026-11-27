"""Extract dated source metadata; uncertain issuer/news claims remain staged."""
import json
import re
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser

from update_pipeline import NY, digest, stamp


def canonical_url(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Publication evidence requires a public HTTPS URL.')
    query = [(key, value) for key, value in urllib.parse.parse_qsl(parsed.query) if not key.lower().startswith(('utm_', 'guce_', 'guccounter'))]
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc.lower(), parsed.path, urllib.parse.urlencode(query), ''))


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts, self.hidden = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.hidden += 1

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def plain(value):
    parser = PlainText()
    parser.feed(value)
    return ' '.join(' '.join(parser.parts).split())


def parse_yahoo(raw):
    tree = ET.fromstring(raw)
    items = []
    for node in tree.findall('.//item'):
        title, url = node.findtext('title'), node.findtext('link')
        if not title or not url:
            continue
        reported = node.findtext('pubDate') or ''
        published, day = None, None
        try:
            value = parsedate_to_datetime(reported)
            day = value.date().isoformat()
            if value.tzinfo:
                published = value.isoformat()
                day = value.astimezone(NY).date().isoformat()
        except (ValueError, TypeError):
            pass
        items.append({'headline': plain(title), 'sourceUrl': canonical_url(url),
                      'publishedAt': published, 'publicationDate': day,
                      'reportedClock': reported, 'publisher': node.findtext('source') or 'Yahoo Finance feed',
                      'excerpt': plain(node.findtext('description') or '')[:500]})
    return items


class FinvizNews(HTMLParser):
    def __init__(self):
        super().__init__()
        self.depth = 0
        self.row = None
        self.anchor = None
        self.items = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == 'table':
            if self.depth or attributes.get('id') == 'news-table':
                self.depth += 1
        if not self.depth:
            return
        if tag == 'tr':
            self.row = {'text': [], 'title': [], 'url': ''}
        if tag == 'a' and self.row is not None and ('tab-link-news' in attributes.get('class', '') or not self.row['url']):
            self.anchor = True
            self.row['url'] = attributes.get('href', '')

    def handle_endtag(self, tag):
        if tag == 'a':
            self.anchor = None
        if tag == 'tr' and self.row:
            self.items.append(self.row)
            self.row = None
        if tag == 'table' and self.depth:
            self.depth -= 1

    def handle_data(self, value):
        if self.depth and self.row is not None:
            self.row['text'].append(value)
            if self.anchor:
                self.row['title'].append(value)


def parse_finviz(raw):
    parser = FinvizNews()
    parser.feed(raw.decode('utf-8', errors='replace'))
    result, previous_day = [], None
    for row in parser.items:
        text = ' '.join(' '.join(row['text']).split())
        match = re.search(r'\b([A-Z][a-z]{2}-\d{2}-\d{2})\b', text)
        if match:
            previous_day = datetime.strptime(match[1], '%b-%d-%y').date().isoformat()
        elif re.search(r'\b(?:Today|Yesterday)\b', text):
            previous_day = None
        if not row['url'] or not row['title']:
            continue
        result.append({'headline': ' '.join(' '.join(row['title']).split()), 'sourceUrl': canonical_url(urllib.parse.urljoin('https://finviz.com', row['url'])),
                       'publishedAt': None, 'publicationDate': previous_day, 'reportedClock': text[:100],
                       'publisher': 'Finviz linked publication', 'excerpt': ''})
    return result


def matching_entries(item, entries, hours=48, fallback_days=2):
    matched = []
    for entry in entries:
        opened = stamp(entry['opened'])
        if item.get('publishedAt'):
            published = stamp(item['publishedAt'])
            if opened - timedelta(hours=hours) <= published < opened:
                matched.append(entry)
        elif item.get('publicationDate'):
            days = (opened.astimezone(NY).date() - date.fromisoformat(item['publicationDate'])).days
            if 0 <= days <= fallback_days:
                matched.append(entry)
    return matched


def news_candidate(item, job, receipt, config, trusted_sec=False):
    entries = matching_entries(item, job['entries'], config['hours'], config['dateFallbackDays'])
    if not entries and (item.get('publishedAt') or item.get('publicationDate')):
        return None
    evidence = {**item, 'receipt': {key: receipt.get(key) for key in ('url', 'sha256', 'fetchedAt')}}
    reasons = [] if trusted_sec else ['issuer_identity_and_article_contents_require_review']
    if not item.get('publicationDate'):
        reasons.append('publication_date_unconfirmed')
    return {'id': 'news-' + digest([job['cik'], canonical_url(item['sourceUrl'])])[:24],
            'domain': 'news', 'symbols': job['symbols'], 'cik': job['cik'], 'jobIds': [job['id']],
            'entries': entries or job['entries'], **item, 'reasons': reasons,
            'evidenceHash': digest(item), 'receipt': evidence['receipt'],
            'proposal': {'kind': 'issuer_filing' if trusted_sec else 'requires_classification',
                         'timePrecision': 'second' if item.get('publishedAt') else 'day',
                         'ready': trusted_sec and bool(item.get('publicationDate'))}}


def filing_rows(payload):
    recent = payload.get('filings', {}).get('recent', payload)
    forms = recent.get('form', [])
    for index, form in enumerate(forms):
        yield {key: values[index] for key, values in recent.items() if isinstance(values, list) and len(values) > index}


def relevant_submission_files(payload, job):
    if not job.get('start'):
        return []
    first = (min(stamp(entry['opened']).astimezone(NY).date() for entry in job['entries']) - timedelta(days=2)).isoformat()
    last = max(stamp(entry['opened']).astimezone(NY).date() for entry in job['entries']).isoformat()
    return [item['name'] for item in payload.get('filings', {}).get('files', [])
            if item.get('filingFrom', '') <= last and item.get('filingTo', '9999') >= first
            and re.fullmatch(r'CIK\d+-submissions-\d+\.json', item.get('name', ''))]


def sec_filing_item(row, cik):
    accession, document = row.get('accessionNumber', ''), row.get('primaryDocument', '')
    if not re.fullmatch(r'\d{10}-\d{2}-\d{6}', accession) or not document or '/' in document or '\\' in document:
        return None
    try:
        day = date.fromisoformat(row['filingDate']).isoformat()
    except (ValueError, KeyError):
        return None
    return {'headline': f'SEC {row["form"]} filed on {day}',
            'sourceUrl': f'https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession.replace("-", "")}/{document}',
            'publicationDate': day, 'publishedAt': None, 'publisher': 'SEC EDGAR',
            'reportedClock': row.get('acceptanceDateTime'),
            'excerpt': 'Official EDGAR submissions metadata confirms the filing identity and filing date. Filing contents have not been interpreted. Acceptance time is audit metadata, not an invented publication time.'}


def collect_news(job, cache, config):
    candidates, receipts = [], []
    for symbol in job['symbols']:
        for provider in ('finviz', 'yahoo'):
            if provider not in config['providers']:
                continue
            encoded = urllib.parse.quote(symbol, safe='')
            url = f'https://finviz.com/stock?t={encoded}' if provider == 'finviz' else f'https://feeds.finance.yahoo.com/rss/2.0/headline?s={encoded}&region=US&lang=en-US'
            raw, receipt = cache.get(url)
            receipts.append({**receipt, 'provider': provider, 'coverage': 'recent_listing_not_exhaustive_historical_search'})
            if raw is None:
                continue
            try:
                items = parse_finviz(raw) if provider == 'finviz' else parse_yahoo(raw)
                for item in items:
                    candidate = news_candidate(item, job, receipt, config)
                    if candidate:
                        candidates.append(candidate)
            except (ValueError, ET.ParseError):
                receipts[-1]['parseStatus'] = 'unsupported_source_response'
    if 'sec' in config['providers'] and job.get('cik'):
        url = f'https://data.sec.gov/submissions/CIK{int(job["cik"]):010d}.json'
        raw, receipt = cache.get(url)
        receipts.append({**receipt, 'provider': 'sec'})
        if raw is not None:
            payload = json.loads(raw)
            if str(payload.get('cik', '')).lstrip('0') != job['cik']:
                receipts[-1]['parseStatus'] = 'issuer_cik_mismatch'
                return candidates, receipts
            sources = [(payload, receipt)]
            for name in relevant_submission_files(payload, job):
                archive, audit = cache.get('https://data.sec.gov/submissions/' + name)
                receipts.append({**audit, 'provider': 'sec_archive'})
                if archive is not None:
                    sources.append((json.loads(archive), audit))
            for source, audit in sources:
                for row in filing_rows(source):
                    if row['form'] not in config['secForms']:
                        continue
                    item = sec_filing_item(row, job['cik'])
                    candidate = news_candidate(item, job, audit, config, trusted_sec=True) if item else None
                    if candidate:
                        candidates.append(candidate)
    return candidates, receipts


def collect_sec(job, cache, config):
    if not job.get('cik'):
        return [], [{'access': 'issuer_identity_required'}]
    cik = int(job['cik'])
    candidates, receipts = [], []
    sources = []
    if set(job['missingFields']) & {'issuer_name', 'incorporation_country', 'incorporation_jurisdiction', 'security_type'}:
        sources.append(('profile', f'https://data.sec.gov/submissions/CIK{cik:010d}.json'))
    if set(job['missingFields']) & {'sharesOutstanding', 'publicFloatValue'}:
        sources.append(('facts', f'https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json'))
    for source_type, url in sources:
        raw, receipt = cache.get(url)
        receipts.append(receipt)
        if raw is None:
            continue
        payload = json.loads(raw)
        if str(payload.get('cik', '')).lstrip('0') != str(cik):
            receipts[-1]['parseStatus'] = 'issuer_cik_mismatch'
            continue
        proposals = []
        if source_type == 'profile':
            if set(job['missingFields']) & {'issuer_name', 'incorporation_country', 'incorporation_jurisdiction', 'security_type'}:
                proposals.append({'issuerName': payload.get('name'), 'incorporationCode': payload.get('stateOfIncorporation'),
                                  'incorporationDescription': payload.get('stateOfIncorporationDescription'),
                                  'recentFilings': list(filing_rows(payload))[:3]})
        else:
            tags = [('dei', 'EntityCommonStockSharesOutstanding', 'shares'), ('us-gaap', 'CommonStockSharesOutstanding', 'shares'),
                    ('dei', 'EntityPublicFloat', 'USD')]
            for namespace, tag, unit in tags:
                facts = payload.get('facts', {}).get(namespace, {}).get(tag, {}).get('units', {}).get(unit, [])
                relevant = [fact for fact in facts if fact.get('end') and fact['end'] <= max(entry['opened'][:10] for entry in job['entries'])]
                distinct = {}
                for fact in sorted(relevant, key=lambda item: item.get('filed', '')):
                    distinct.setdefault((fact['end'], fact.get('val')), fact)
                relevant = sorted(distinct.values(), key=lambda fact: fact['end'], reverse=True)
                for fact in relevant[:config['maxFactCandidatesPerIssuer']]:
                    proposals.append({'taxonomy': namespace, 'tag': tag, 'unit': unit, **fact})
        for proposal in proposals[:config['maxFactCandidatesPerIssuer']]:
            candidates.append({'id': 'sec-' + digest([cik, proposal])[:24], 'domain': 'sec', 'symbols': job['symbols'],
                               'cik': str(cik), 'entries': job['entries'], 'jobIds': [job['id']], 'sourceUrl': url,
                               'headline': f'SEC {source_type} evidence', 'publicationDate': proposal.get('filed'),
                               'publishedAt': None, 'excerpt': '', 'proposal': proposal,
                               'reasons': ['review_filing_context_share_class_split_and_ads_basis', 'do_not_infer_operating_country_from_headquarters'],
                               'evidenceHash': digest(proposal), 'receipt': {key: receipt.get(key) for key in ('url', 'sha256', 'fetchedAt')}})
    if set(job['missingFields']) & {'operating_country', 'floatShares', 'security_type'}:
        from research_tickers import evidence_windows
        for filing in job.get('filingEvidence', [])[:1]:
            url = filing['url']
            try:
                raw, receipt = cache.get(url)
            except ValueError:
                receipts.append({'url': url, 'access': 'source_adapter_required'})
                continue
            receipts.append(receipt)
            if raw is None:
                continue
            text = plain(raw.decode('utf-8', errors='replace'))
            windows = evidence_windows(text)
            proposal = {'filingUrl': url, 'filedOn': filing.get('filedOn'),
                        'operations': windows['operations'][:5], 'security': windows['security'][:3]}
            float_matches = list(re.finditer(r'aggregate market value|shares outstanding|held by non.affiliates', text, re.I))[:5]
            proposal['capital'] = [text[max(0, match.start() - 80):match.end() + 220] for match in float_matches]
            candidates.append({'id': 'sec-filing-' + digest([job['cik'], url, proposal])[:24], 'domain': 'sec',
                               'symbols': job['symbols'], 'cik': job['cik'], 'entries': job['entries'], 'jobIds': [job['id']],
                               'sourceUrl': url, 'headline': 'Targeted SEC filing excerpts', 'publicationDate': filing.get('filedOn'),
                               'publishedAt': None, 'excerpt': '', 'proposal': proposal,
                               'reasons': ['review_excerpts_in_filing_context_before_classifying_or_calculating'],
                               'evidenceHash': digest(proposal), 'receipt': {key: receipt.get(key) for key in ('url', 'sha256', 'fetchedAt')}})
    return candidates, receipts
