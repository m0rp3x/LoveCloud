#!/usr/bin/env python3
"""Allowlisted, deterministic installation artifacts for one already fixed Git SHA."""
import argparse
import hashlib
import io
import json
import pathlib
import re
import subprocess
import tarfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
FILES = ['VERSION', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES', '.env.example',
         'compose.yaml', 'compose.https.yaml', 'compose.tailnet.yaml',
         'scripts/init.sh', 'scripts/init.ps1', 'scripts/backup.sh', 'scripts/backup.ps1',
         'scripts/restore.sh', 'scripts/restore.ps1',
         'README.md', 'README.ru.md']
TREES = ['ops', 'licenses', 'docs']
BASELINE = '381a7965e6dab32e7acfc4dfe0184979ceeafab8'

def sha(path):
    return hashlib.file_digest(path.open('rb'), 'sha256').hexdigest()

def write_manifest(out, manifest):
    eligible = sorted(p for p in out.iterdir() if p.is_file() and p.name != 'release-manifest.json' and p.name != 'SHA256SUMS')
    # This directory is dedicated to public release artifacts, never test state.
    for p in eligible:
        if not (p.name.startswith('lovecloud-') or p.name.endswith('.spdx.json') or p.name in ['verification.json', 'build-inputs.json', 'image-lock.json']):
            raise RuntimeError('Unexpected public artifact: ' + p.name)
    manifest['artifacts'] = [{'name': p.name, 'sha256': sha(p), 'bytes': p.stat().st_size} for p in eligible]
    target = out / 'release-manifest.json'
    target.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    (out / 'SHA256SUMS').write_text(''.join(f'{sha(p)}  {p.name}\n' for p in eligible + [target]), encoding='utf-8')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-sha', required=True)
    parser.add_argument('--images', required=True)
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--run-url', required=True)
    parser.add_argument('--report')
    parser.add_argument('--finalize', action='store_true')
    parser.add_argument('--anonymous-pull-verified', action='store_true')
    a = parser.parse_args()
    if not re.fullmatch('[0-9a-f]{40}', a.source_sha):
        parser.error('Full Git SHA required')
    version = (ROOT / 'VERSION').read_text().strip()
    lock_path = pathlib.Path(a.images).resolve()
    lock = json.loads(lock_path.read_text())
    if lock['sourceSha'] != a.source_sha:
        raise RuntimeError('Image/source SHA mismatch')
    out = pathlib.Path(a.output_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)
    if a.finalize:
        manifest = json.loads((out / 'release-manifest.json').read_text())
        if manifest['sourceSha'] != a.source_sha:
            raise RuntimeError('Cannot finalize another source revision')
        for artifact in manifest['artifacts']:
            if sha(out / artifact['name']) != artifact['sha256']:
                raise RuntimeError('Candidate artifact changed: ' + artifact['name'])
    else:
        current = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
        if current != a.source_sha:
            raise RuntimeError('Packaging checkout does not match release SHA')
        # Read ONLY committed files from this exact tree, never a working copy.
        paths = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', a.source_sha], cwd=ROOT, text=True).splitlines()
        included = [p for p in paths if p in FILES or any(p.startswith(t + '/') for t in TREES)]
        for required in FILES:
            if required not in included:
                raise RuntimeError('Missing installation file: ' + required)
        payload = {p: subprocess.check_output(['git', 'show', a.source_sha + ':' + p], cwd=ROOT) for p in included}
        for name in ['compose.images.yaml', 'release.env', 'image-lock.json']:
            payload[name] = (lock_path.parent / name).read_bytes()
        # Optional services must also use immutable image references in the bundle.
        for name, service in [('compose.https.yaml', 'caddy'), ('compose.tailnet.yaml', 'tailscale')]:
            payload[name] = re.sub(rb'image: \$\{[^\n]+\}', ('image: ' + lock['images'][service]['reference']).encode(), payload[name], count=1)
        payload['INSTALL.txt'] = ('LoveCloud v' + version + '\nLinux amd64. Requires Docker + Compose >=2.24.4; shell needs openssl.\nPOSIX shell: sh scripts/init.sh --start\nPowerShell7: ./scripts/init.ps1 -Start\nPowerShell7 on Linux is tested; Windows Docker Desktop is not release-validated.\nOne-time setup link contains a private secret. Keep it private.\nFull instructions: docs/INSTALL.md and docs/OPERATIONS.md\n').encode()
        prefix = f'lovecloud-v{version}'
        stamp = int(subprocess.check_output(['git', 'show', '-s', '--format=%ct', a.source_sha], cwd=ROOT, text=True))
        raw_tar = io.BytesIO()
        with tarfile.open(fileobj=raw_tar, mode='w') as tar, zipfile.ZipFile(out / (prefix + '-install.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
            for name, data in sorted(payload.items()):
                if name.startswith('/') or '..' in pathlib.PurePosixPath(name).parts:
                    raise RuntimeError('Invalid archive path')
                info = tarfile.TarInfo(prefix + '/' + name)
                info.size = len(data); info.mtime = stamp; info.mode = 0o755 if name.endswith('.sh') else 0o644
                tar.addfile(info, io.BytesIO(data))
                zi = zipfile.ZipInfo(info.name, (2026, 1, 1, 0, 0, 0))
                zi.external_attr = (0o100000 | info.mode) << 16
                zi.compress_type = zipfile.ZIP_DEFLATED
                z.writestr(zi, data)
        import gzip
        with (out / (prefix + '-install.tar.gz')).open('wb') as target:
            with gzip.GzipFile(fileobj=target, mode='wb', filename='', mtime=0) as gz:
                gz.write(raw_tar.getvalue())
        # Open both finished containers, not just their in-memory input.
        with tarfile.open(out / (prefix + '-install.tar.gz'), 'r:gz') as tar, zipfile.ZipFile(out / (prefix + '-install.zip')) as z:
            expected = {prefix + '/' + name: data for name, data in payload.items()}
            if {m.name for m in tar.getmembers()} != set(expected) or set(z.namelist()) != set(expected):
                raise RuntimeError('Finished archive inventory mismatch')
            for name, data in expected.items():
                if tar.extractfile(name).read() != data or z.read(name) != data:
                    raise RuntimeError('Finished archive content mismatch: ' + name)
        subprocess.run(['git', 'archive', '--format=tar.gz', '--prefix=' + prefix + '-source/', '--output=' + str(out / (prefix + '-source.tar.gz')), a.source_sha], cwd=ROOT, check=True)
        with tarfile.open(out / (prefix + '-source.tar.gz'), 'r:gz') as source:
            if source.pax_headers.get('comment') != a.source_sha:
                raise RuntimeError('Source archive does not identify the exact release commit')
        (out / (prefix + '-release-notes.md')).write_bytes(payload['docs/releases/v' + version + '.md'])
        manifest = {'version': version, 'repository': 'https://github.com/m0rp3x/LoveCloud', 'sourceSha': a.source_sha,
                    'workflowRun': a.run_url, 'platforms': ['linux/amd64'], 'images': lock['images'],
                    'upgradeBaseline': BASELINE, 'checks': [{'name': 'candidate acceptance', 'status': 'NOT RUN', 'detail': 'Awaiting final artifact verification'}]}
    if a.report:
        result = json.loads(pathlib.Path(a.report).read_text())
        if result['sourceSha'] != a.source_sha or not result.get('checks'):
            raise RuntimeError('Verification report does not identify this candidate')
        for name in ['api', 'frontend']:
            if result['images'][name] != lock['images'][name]['reference']:
                raise RuntimeError('Verification used other image: ' + name)
        if any(c['status'] not in ['PASS', 'FAIL', 'NOT RUN'] for c in result['checks']):
            raise RuntimeError('Invalid verification status')
        manifest['checks'] = result['checks']
        if result.get('baselineImages'):
            manifest['baselineImages'] = result['baselineImages']
    if a.anonymous_pull_verified:
        if not a.finalize:
            raise RuntimeError('Anonymous pull is a post-acceptance publication check')
        manifest['checks'] = [c for c in manifest['checks'] if c['name'] != 'anonymous GHCR pull']
        manifest['checks'].append({'name': 'anonymous GHCR pull', 'status': 'PASS', 'detail': 'Both exact own-image digests pulled using an empty Docker configuration in publication workflow.'})
    write_manifest(out, manifest)

if __name__ == '__main__':
    main()
