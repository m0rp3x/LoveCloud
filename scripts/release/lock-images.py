#!/usr/bin/env python3
"""Make an immutable deployment lock from the images actually built by CI."""
import argparse
import json
import pathlib
import re

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--inputs', required=True)
    p.add_argument('--api', required=True)
    p.add_argument('--frontend', required=True)
    p.add_argument('--source-sha', required=True)
    p.add_argument('--output-dir', required=True)
    a = p.parse_args()
    if not re.fullmatch(r'[0-9a-f]{40}', a.source_sha):
        p.error('source-sha must be the complete release commit')
    images = json.loads(pathlib.Path(a.inputs).read_text())
    for key in ('api', 'frontend'):
        ref = getattr(a, key)
        if not re.fullmatch(r'ghcr\.io/m0rp3x/lovecloud-(api|frontend)@sha256:[0-9a-f]{64}', ref):
            p.error('Own images must be exact GHCR digests')
        images[key] = {'reference': ref, 'digest': ref.split('@')[1], 'platform': 'linux/amd64'}
    output = pathlib.Path(a.output_dir)
    output.mkdir(parents=True, exist_ok=True)
    lock = {'sourceSha': a.source_sha, 'platform': 'linux/amd64', 'images': images}
    (output / 'image-lock.json').write_text(json.dumps(lock, indent=2) + '\n')
    lines = ['# Generated from the fixed release SHA; do not replace image digests.', 'services:']
    for service in ('db', 'api', 'frontend', 'gateway'):
        lines += [f'  {service}:', '    image: ' + images[service]['reference'], '    platform: linux/amd64']
    (output / 'compose.images.yaml').write_text('\n'.join(lines) + '\n')
    variables = {'db': 'POSTGRES', 'gateway': 'NGINX', 'caddy': 'CADDY', 'tailscale': 'TAILSCALE', 'backup': 'BACKUP'}
    (output / 'release.env').write_text(''.join(f'LOVECLOUD_{env}_IMAGE={images[key]["reference"]}\n' for key, env in variables.items()))

if __name__ == '__main__':
    main()
