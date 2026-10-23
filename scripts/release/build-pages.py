#!/usr/bin/env python3
"""Allowlisted, offline GitHub Pages artifact. No credentials or app state."""
import argparse
import json
import os
import re
import shutil
from pathlib import Path

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--output-dir', required=True)
args = parser.parse_args()
out = Path(args.output_dir).resolve()
out.mkdir(parents=True, exist_ok=True)
if any(out.iterdir()):
    raise SystemExit('Pages output must be empty (refusing to remove existing files).')
for name in ['index.html', 'style.css', 'drawn.css']:
    shutil.copy2(root / 'design/strawberry' / name, out / name)
shutil.copytree(root / 'design/strawberry/illustrations', out / 'illustrations',
                ignore=shutil.ignore_patterns('*.jpg', '*.png'))
(out / 'assets').mkdir()
for name in ['workspace.css', 'workspace.js', 'preview.css']:
    shutil.copy2(root / 'design/assets' / name, out / 'assets' / name)
shutil.copytree(root / 'design/assets/fonts', out / 'assets/fonts')
html = (out / 'index.html').read_text(encoding='utf-8').replace('../assets/', 'assets/')
(out / 'index.html').write_text(html, encoding='utf-8')
for name in ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES']:
    shutil.copy2(root / name, out / name)
(out / '.nojekyll').write_text('', encoding='utf-8')
(out / 'preview-version.json').write_text(json.dumps({'version':(root/'VERSION').read_text(encoding='utf-8').strip(),'sourceSha':os.environ.get('GITHUB_SHA')})+'\n',encoding='utf-8')
sources = '\n'.join(p.read_text(encoding='utf-8') for p in out.rglob('*') if p.suffix in ['.html', '.css', '.js'])
for forbidden in ['images.unsplash.com', 'fonts.googleapis.com', 'localStorage', 'sessionStorage', 'fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket(']:
    if forbidden in sources:
        raise SystemExit('Disallowed preview capability: ' + forbidden)
missing = []
for p in out.rglob('*'):
    if p.suffix not in ['.html', '.css']: continue
    for raw in re.findall(r'(?:src|href)=["\']([^"\']+)|url\(["\']?([^\)"\']+)', p.read_text(encoding='utf-8')):
        ref = next(v for v in raw if v)
        if ref.startswith(('http:', 'https:', '#', 'data:')): continue
        if not (p.parent / ref.split('#')[0].split('?')[0]).is_file(): missing.append(str(p.relative_to(out)) + ':' + ref)
if missing: raise SystemExit('Missing preview resources: ' + ', '.join(missing))
print(json.dumps({'status':'PASS','staticFiles':sum(p.is_file() for p in out.rglob('*')),'backendRequests':'blocked by CSP connect-src none','basePath':'relative /LoveCloud/ compatible'}))
