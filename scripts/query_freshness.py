"""Write small source-version markers before replacing generated source data."""
import hashlib
import json
from pathlib import Path


def version_path(path):
    if path.name == 'trade-context.json': return path.with_name('context-version.json')
    if path.name == 'trade-capital.json': return path.with_name('capital-version.json')
    raise ValueError('Unknown versioned source')


def atomic_write(path, contents):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_bytes() == contents:
        return
    temp = path.with_name(path.name + '.tmp')
    temp.write_bytes(contents)
    temp.replace(path)


def marker(contents):
    return (json.dumps({'schemaVersion': 1, 'sha256': hashlib.sha256(contents).hexdigest()}, separators=(',', ':')) + '\n').encode('utf-8')


def sync_source_marker(path):
    path = Path(path)
    atomic_write(version_path(path), marker(path.read_bytes()))


def write_versioned_json(path, value):
    path = Path(path)
    contents = (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode('utf-8')
    atomic_write(version_path(path), marker(contents))
    atomic_write(path, contents)
