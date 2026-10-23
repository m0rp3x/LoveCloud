#!/usr/bin/env python3
"""Fail closed before any tag, image promotion or Release publication."""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('directory')
    parser.add_argument('--source-sha', required=True)
    parser.add_argument('--pre-publication', action='store_true', help='Validate original candidate before adding Pages and anonymous-pull publication evidence')
    a = parser.parse_args()
    directory = pathlib.Path(a.directory)
    manifest = json.loads((directory / 'release-manifest.json').read_text())
    if manifest['sourceSha'] != a.source_sha:
        raise RuntimeError('Release/source SHA mismatch')
    if manifest['version'] != pathlib.Path('VERSION').read_text().strip():
        raise RuntimeError('Release/VERSION mismatch')
    checks = manifest['checks']
    required = {
        'install archive allowlist', 'shell installation from archive',
        'initial setup, avatars, access and restart', 'private images and removed optimizer',
        'PowerShell installation from archive', 'backend core, native avatars and setup races',
        'candidate HTTP, files, Range and SignalR',
        'baseline synthetic functional data', 'consistent encrypted backup',
        'restore isolated project and originals', 'PowerShell encrypted backup and restore',
        'update same project and custom volumes', 'candidate recreation persistence',
        'frontend lockfile, typecheck and production build', 'backend locked restore and Release build',
        'actual runtime SBOM, license notices and corresponding sources',
    }
    if not a.pre_publication:
        required |= {'interactive preview artifact', 'published interactive preview', 'anonymous GHCR pull'}
    if not required.issubset({c['name'] for c in checks}):
        raise RuntimeError('Mandatory acceptance checks are missing from the manifest')
    if not checks or any(c['status'] != 'PASS' for c in checks if c.get('required', True)):
        raise RuntimeError('Every mandatory check must be PASS before publishing')
    for artifact in manifest['artifacts']:
        name = artifact['name']
        if pathlib.Path(name).name != name:
            raise RuntimeError('Invalid artifact path')
        if hashlib.file_digest((directory / name).open('rb'), 'sha256').hexdigest() != artifact['sha256']:
            raise RuntimeError('Artifact checksum mismatch: ' + name)
    for key in ['api', 'frontend']:
        ref = manifest['images'][key]['reference']
        if not re.fullmatch(r'ghcr\.io/m0rp3x/lovecloud-' + key + r'@sha256:[0-9a-f]{64}', ref):
            raise RuntimeError('Missing immutable image reference')
        labels = json.loads(subprocess.check_output(['docker', 'image', 'inspect', ref, '--format', '{{json .Config.Labels}}'], text=True))
        for label, expected in [('revision', a.source_sha), ('version', manifest['version']), ('licenses', 'Apache-2.0'), ('source', manifest['repository'])]:
            if labels.get('org.opencontainers.image.' + label) != expected:
                raise RuntimeError('OCI label mismatch: ' + key + '/' + label)
    required = [f'lovecloud-v{manifest["version"]}-{kind}' for kind in ['install.tar.gz', 'install.zip', 'source.tar.gz', 'third-party-licenses.tar.gz']]
    names = {x['name'] for x in manifest['artifacts']}
    if not set(required).issubset(names) or not {'api.spdx.json', 'frontend.spdx.json'}.issubset(names):
        raise RuntimeError('Missing release archive or actual-image SBOM')
    print('Release SHA, checks, hashes and OCI labels verified.')

if __name__ == '__main__':
    main()
