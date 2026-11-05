#!/usr/bin/env python3
"""Build an auditable issuer database from downloaded primary sources and reviewed overrides."""
import csv
import argparse
import json
import re
from collections import Counter
from pathlib import Path

from research_tickers import CACHE, REFERENCE, ROOT, AS_OF, FIELDS, US_STATES

COUNTRIES = {
    'China': r'(?:mainland China|the PRC|the People.s Republic of China|China)',
    'Hong Kong': r'Hong Kong(?: SAR)?', 'United States': r'(?:the United States|United States|the U\.S\.|U\.S\.)',
    'Taiwan': r'Taiwan', 'Singapore': r'Singapore', 'Malaysia': r'Malaysia', 'Japan': r'Japan',
    'Israel': r'Israel', 'India': r'India', 'Australia': r'Australia', 'Canada': r'Canada',
    'United Kingdom': r'(?:the United Kingdom|United Kingdom|the UK|UK)', 'Germany': r'Germany',
    'Denmark': r'Denmark', 'Belgium': r'Belgium', 'Netherlands': r'(?:the Netherlands|Netherlands)',
    'United Arab Emirates': r'(?:the United Arab Emirates|United Arab Emirates|the UAE|UAE)',
    'Ireland': r'Ireland', 'Sweden': r'Sweden', 'Switzerland': r'Switzerland', 'Greece': r'Greece',
    'Cyprus': r'Cyprus', 'South Korea': r'(?:South Korea|Republic of Korea)', 'France': r'France',
    'Brazil': r'Brazil', 'Indonesia': r'Indonesia', 'Thailand': r'Thailand', 'Vietnam': r'Vietnam',
    'Bermuda': r'Bermuda', 'Cayman Islands': r'(?:the Cayman Islands|Cayman Islands)',
    'British Virgin Islands': r'(?:the British Virgin Islands|British Virgin Islands)',
    'Marshall Islands': r'(?:the Marshall Islands|Marshall Islands)', 'Luxembourg': r'Luxembourg',
    'Mexico': r'(?<!New )Mexico', 'Spain': r'Spain', 'Italy': r'Italy', 'Austria': r'Austria',
    'New Zealand': r'New Zealand', 'Norway': r'Norway', 'Finland': r'Finland',
    'South Africa': r'South Africa', 'Philippines': r'(?:the Philippines|Philippines)', 'Egypt': r'Egypt'
}
STATE_NAMES = 'Alabama Alaska Arizona Arkansas California Colorado Connecticut Delaware Florida Georgia Hawaii Idaho Illinois Indiana Iowa Kansas Kentucky Louisiana Maine Maryland Massachusetts Michigan Minnesota Mississippi Missouri Montana Nebraska Nevada Ohio Oklahoma Oregon Pennsylvania Tennessee Texas Utah Vermont Virginia Washington Wisconsin Wyoming'.split()
STATE_PATTERN = r'\b(?:' + '|'.join(STATE_NAMES + ['New York', 'New Jersey', 'New Mexico', 'North Carolina', 'South Carolina', 'Rhode Island', 'New Hampshire', 'South Dakota', 'North Dakota', 'West Virginia', 'District of Columbia']) + r')\b'
EXTRA_FIELDS = ['operations_basis', 'security_basis', 'vie_basis', 'historical_note']
OPERATING_MATCHES = []
US_JURISDICTIONS = dict(zip(
    'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(),
    ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming']
))


def normalize_country(value):
    if 'Canada' in value:
        return 'Canada'
    if value in US_STATES:
        return 'United States'
    return value


def operating_evidence(text):
    contexts = [text[max(0, match.start()-90):match.end()+260] for match in re.finditer(
        r'(?:substantially all|all|most|the majority) of (?:our|the Company.s|the Group.s)|our (?:business )?operations|we (?:conduct|operate|generate|derive)|principal operations', text, re.I)]
    text = '\n'.join(contexts)
    evidence = {}
    for country, name in COUNTRIES.items():
        own = r'(?:our|the Company.s|the Group.s|the PRC operating entities.)'
        patterns = [
            rf'(?:substantially all|all|most|the majority) of {own} (?:current )?(?:business )?(?:operations|revenues?|assets)[^.{{}}]{{0,90}}?\b(?:in|from)\s+{name}\b',
            rf'{own} (?:business )?operations (?:are|is|were)?\s*(?:primarily|principally|predominantly|mainly)[^.{{}}]{{0,45}}?\b(?:in|from)\s+{name}\b',
            rf'\bwe (?:conduct|operate|generate|derive)[^.{{}}]{{0,110}}?(?:all|primarily|principally|substantially all)[^.{{}}]{{0,80}}?\b(?:in|from)\s+{name}\b',
            rf'\bprincipal operations (?:are )?(?:located )?in\s+{name}\b',
        ]
        for pattern in patterns:
            match = re.search(pattern, text, re.I)
            if match:
                context = text[max(0, match.start()-90):match.end()+60]
                if re.search(r'\b(?:historically|previously|prior to|formerly|no longer|terminated|discontinued|in the event|any judgment|outside|audits|auditor)\b', context, re.I):
                    continue
                location_clause = match.group() + text[match.end():match.end()+65].split('.')[0]
                if any(other != country and re.search(r'\b' + other_name + r'\b', location_clause, re.I) for other, other_name in COUNTRIES.items()):
                    continue
                OPERATING_MATCHES.append((country, match.group(), context))
                evidence[country] = 'Explicit operating, revenue or asset concentration disclosure in the annual report.'
                break
    if 'Hong Kong' in evidence and 'China' in evidence:
        # Preserve uncertainty if the report actually describes both jurisdictions.
        return '', 'Multiple China/Hong Kong concentration statements require review.'
    if len(evidence) == 1:
        return next(iter(evidence)), next(iter(evidence.values()))
    return '', 'Multiple countries disclosed; no single principal operating country established.' if evidence else ''


def functional_facility_evidence(text, headquarters):
    sections = []
    for match in re.finditer(r'ITEM\s+2[.|:\-\s]*(?:PROPERTIES|DESCRIPTION OF PROPERTY)', text, re.I):
        section = text[match.end():match.end()+7000]
        stop = re.search(r'ITEM\s+3[.|:\-\s]*LEGAL', section, re.I)
        if not stop or stop.start() < 60:
            continue
        sections.append(section[:stop.start()])
    if not sections:
        return '', ''
    section = sections[-1]
    if not re.search(r'manufactur|laborator|research|development|distribution|production|operat', section, re.I):
        return '', ''
    countries = {country for country, pattern in COUNTRIES.items() if re.search(r'\b' + pattern + r'\b', section, re.I)}
    if re.search(STATE_PATTERN, section) or re.search(r'\b(?:CA|TX|FL|NY|MA|NJ|PA|MD|NC|SC|VA|WA|CO|UT|WI|MN|TN|AZ|OH|CT|NV),?\s+\d{5}', section):
        countries.add('United States')
    if len(countries) == 1 and headquarters in countries:
        return headquarters, 'Analyst inference: the properties section identifies functional business facilities only in this country, consistent with the disclosed headquarters. Not a guarantee of exclusive legal exposure.'
    return '', ''


def security_evidence(text):
    start = re.search(r'UNITED STATES\s+SECURITIES AND EXCHANGE COMMISSION', text, re.I)
    offset = start.start() if start else 0
    cover = text[offset:offset+22000]
    marker = re.search(r'Securities registered.{0,65}Section\s+12\s*\(?b\)?', cover, re.I)
    if marker:
        section = cover[marker.start():marker.start()+2400]
        stop = re.search(r'Securities registered.{0,65}Section\s+12\s*\(?g\)?|Indicate by check mark', section[120:], re.I)
        if stop:
            section = section[:stop.start()+120]
        if re.search(r'American depositary (?:shares|receipts)|\bADSs?\b', section, re.I):
            return 'ADS', 'The registered-security cover table identifies American depositary shares.'
        if re.search(r'common (?:stock|shares)|ordinary shares|Class [AB] (?:ordinary|common|shares)|\bCommon\s+[A-Z]{2,6}\b', section, re.I):
            return 'direct_equity', 'The registered-security cover table identifies common or ordinary shares, rather than depositary shares.'
    title = re.search(r'Title of (?:each|the) class', cover, re.I)
    if title and re.search(r'common (?:stock|shares)|ordinary shares', cover[title.end():title.end()+1000], re.I):
        return 'direct_equity', 'The cover identifies common or ordinary shares as the traded security.'
    offering = re.search(r'(?:prospectus relates|offering of|resale from).{0,180}(?:common stock|ordinary shares)', cover[:10000], re.I)
    if offering and not re.search(r'American depositary', cover[:10000], re.I):
        return 'direct_equity', 'The registration statement identifies common or ordinary shares in the offering or resale.'
    return 'unknown', 'Registered security type could not be established from the cover table.'


def incorporation_from_cover(text):
    cover = text[:20000]
    marker = re.search(r'\((?:State or other |State or |Country or |Jurisdiction of |State or country of )[^)]{0,80}incorporation[^)]*\)', cover, re.I)
    if not marker:
        return '', ''
    before = cover[max(0, marker.start()-180):marker.start()]
    candidates = []
    for country, pattern in COUNTRIES.items():
        for match in re.finditer(r'\b' + pattern + r'\b', before, re.I):
            candidates.append((match.start(), country, match.group()))
    for name in STATE_NAMES + ['New York', 'New Jersey', 'North Carolina', 'South Carolina']:
        for match in re.finditer(r'\b' + name + r'\b', before):
            candidates.append((match.start(), 'United States', name))
    if candidates:
        _, country, jurisdiction = max(candidates)
        return country, jurisdiction
    return '', ''


def vie_evidence(text):
    negative_patterns = [
        r'(?:we|the Company|the Group) (?:do|does) not (?:have|use|utilize|rely on) (?:a |any |the )?(?:variable interest entit|VIE structure)',
        r'neither the holding company nor.{0,100}conduct any operations through contractual arrangements with a variable interest entity',
        r'our corporate structure contains no variable interest entit',
        r'we do not have.{0,130}typically seen in a variable interest entity structure',
        r'(?:we|the Company) (?:do|does) not (?:operate|conduct.{0,30}) through (?:a |any |the )?(?:variable interest entity|VIE)'
    ]
    for pattern in negative_patterns:
        if re.search(pattern, text, re.I):
            return 'no_explicit', 'The filing explicitly states that the issuer does not use the described VIE structure; review historical changes separately.'
    positive_patterns = [
        r'we (?:conduct|operate).{0,110}(?:through|via).{0,70}(?:the VIE\b|our VIE\b|variable interest entit)',
        r'we (?:rely|depend).{0,70}(?:\bVIEs?\b|contractual arrangements.{0,100}variable interest entit)',
        r'our (?:consolidated )?(?:variable interest entit|VIEs?\b)',
        r'through the VIE and its subsidiaries in (?:China|the PRC)'
    ]
    for pattern in positive_patterns:
        for match in re.finditer(pattern, text, re.I):
            context = text[max(0, match.start()-100):match.end()+60]
            if re.search(r'previously|formerly|terminated|prior to|historically', context, re.I):
                continue
            return 'yes_explicit', 'The filing describes the issuer conducting or consolidating business through its VIE or contractual arrangements.'
    return 'unknown', 'No conclusive issuer-specific VIE statement established. Absence of a match is not proof that no VIE exists.'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--symbols', help='Reclassify selected comma-separated symbols, retaining other records')
    args = parser.parse_args()
    selected = set(args.symbols.split(',')) if args.symbols else None
    REFERENCE.mkdir(parents=True, exist_ok=True)
    overrides_path = REFERENCE / 'ticker-review-overrides.json'
    overrides = json.loads(overrides_path.read_text(encoding='utf-8')) if overrides_path.exists() else {}
    current_symbols = {item['ticker'] for item in json.loads((CACHE/'company_tickers.json').read_text(encoding='utf-8')).values()}
    aliases = json.loads((REFERENCE/'ticker-identities.json').read_text(encoding='utf-8'))
    previous_path = REFERENCE / 'ticker-profiles.csv'
    if selected and previous_path.exists():
        with previous_path.open(encoding='utf-8', newline='') as stream:
            previous = {row['symbol']: row for row in csv.DictReader(stream)}
    else:
        previous = {}
    rows = []
    for symbol in sorted({t['symbol'] for t in json.loads((ROOT/'data/trades.json').read_text())['trades']}):
        if selected and symbol not in selected and symbol in previous:
            rows.append(previous[symbol])
            continue
        record = CACHE / f'{symbol}-record.json'
        if not record.exists():
            continue
        row = json.loads(record.read_text(encoding='utf-8'))
        row['identity_status'] = 'current_ticker_match' if symbol in current_symbols else 'historical_ticker_lookup'
        row['identity_source_url'] = ('https://www.sec.gov/files/company_tickers.json' if symbol in current_symbols else aliases.get(symbol, {}).get('source_url') or row['source_filing_url'])
        row.update(dict.fromkeys(EXTRA_FIELDS, ''))
        row['incorporation_country'] = normalize_country(row['incorporation_country'])
        row['headquarters_country'] = normalize_country(row['headquarters_country'])
        path = CACHE / f'{symbol}-filing.txt'
        if path.exists():
            text = path.read_text(encoding='utf-8')
            if not row['incorporation_country']:
                country, jurisdiction = incorporation_from_cover(text)
                if country:
                    row.update(incorporation_country=country, incorporation_jurisdiction=jurisdiction, incorporation_status='filing_cover')
            OPERATING_MATCHES.clear()
            row['operating_country'], row['operations_basis'] = operating_evidence(text)
            (CACHE / f'{symbol}-operating-matches.json').write_text(json.dumps(OPERATING_MATCHES, ensure_ascii=False), encoding='utf-8')
            row['operations_status'] = 'explicit_filing' if row['operating_country'] else 'unverified'
            if not row['operating_country']:
                country, basis = functional_facility_evidence(text, row['headquarters_country'])
                if country:
                    row.update(operating_country=country, operations_basis=basis, operations_status='facilities_inference')
            row['security_type'], row['security_basis'] = security_evidence(text)
            row['structure_status'] = 'cover_table' if row['security_type'] != 'unknown' else 'unverified'
            row['vie_status'], row['vie_basis'] = vie_evidence(text)
            row['notes'] = 'Primary-source extraction. Incorporation, operating exposure and security structure are separate fields. The office country is not substituted for operating country.'
            row['historical_note'] = 'Snapshot checked on 2026-11-05; not a point-in-time legal opinion for every trade. Review corporate reorganizations and ticker changes before historical attribution.'
        row.update(overrides.get(symbol, {}))
        row['review_status'] = 'complete' if row['incorporation_country'] and row['operating_country'] and row['security_type'] != 'unknown' and row['vie_status'] != 'unknown' else 'partial'
        if not row['cik']:
            row['review_status'] = 'unresolved'
        rows.append(row)
        if len(rows) % 50 == 0:
            print(f'Classified {len(rows)} issuer records', flush=True)
    for row in rows:
        if row['incorporation_country'] == 'United States':
            row['incorporation_jurisdiction'] = US_JURISDICTIONS.get(row['incorporation_jurisdiction'], row['incorporation_jurisdiction'])
    with (REFERENCE/'ticker-profiles.csv').open('w', encoding='utf-8', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=FIELDS+EXTRA_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    summary = {'checkedOn': AS_OF, 'tickerCount': len(rows), 'identities': sum(bool(r['cik']) for r in rows),
               'incorporationCountries': sum(bool(r['incorporation_country']) for r in rows),
               'operatingCountries': sum(bool(r['operating_country']) for r in rows),
               'operationsStatus': dict(Counter(r['operations_status'] for r in rows)),
               'securityTypes': dict(Counter(r['security_type'] for r in rows)),
               'vieStatus': dict(Counter(r['vie_status'] for r in rows))}
    (REFERENCE/'research-summary.json').write_text(json.dumps(summary, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
