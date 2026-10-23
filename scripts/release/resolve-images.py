#!/usr/bin/env python3
"""Resolve linux/amd64 registry manifests before building; no Docker daemon needed."""
import argparse
import json
import pathlib
import re
import subprocess

IMAGES = {
    'dotnetSdk': 'mcr.microsoft.com/dotnet/sdk:10.0',
    'dotnetRuntime': 'mcr.microsoft.com/dotnet/aspnet:10.0',
    'node': 'node:24-alpine',
    'db': 'postgres:18-alpine',
    'gateway': 'nginx:alpine',
    'caddy': 'caddy:2-alpine',
    'tailscale': 'tailscale/tailscale:v1.98.4',
    'backup': 'restic/restic:0.18.0',
    'sbom': 'anchore/syft:v1.55.0',
    'builder': 'moby/buildkit:buildx-stable-1',
}

def inspect(ref):
    return json.loads(subprocess.check_output(['docker', 'buildx', 'imagetools', 'inspect', ref, '--format', '{{json .Manifest}}'], text=True))

def resolve(ref):
    manifest = inspect(ref)
    digest = manifest.get('digest')
    for item in manifest.get('manifests', []):
        platform = item.get('platform', {})
        if platform.get('os') == 'linux' and platform.get('architecture') == 'amd64':
            digest = item['digest']
            break
    else:
        if manifest.get('manifests'):
            raise RuntimeError(f'No linux/amd64 manifest: {ref}')
    if not digest or not re.fullmatch(r'sha256:[0-9a-f]{64}', digest):
        raise RuntimeError(f'Missing registry digest: {ref}')
    repository = ref.split('@')[0].rsplit(':', 1)[0]
    pinned = repository + '@' + digest
    config = json.loads(subprocess.check_output(['docker', 'buildx', 'imagetools', 'inspect', pinned, '--format', '{{json .Image}}'], text=True))
    if config.get('os') != 'linux' or config.get('architecture') != 'amd64':
        raise RuntimeError('Unexpected actual image architecture: ' + pinned)
    image_config = config.get('config') or {}
    versions = dict(value.split('=', 1) for value in (image_config.get('Env') or []) if '=' in value and value.split('=', 1)[0].endswith('_VERSION'))
    label_version = (image_config.get('Labels') or {}).get('org.opencontainers.image.version')
    if label_version:
        versions['OCI_VERSION'] = label_version
    return {'tag': ref, 'digest': digest, 'reference': pinned, 'platform': 'linux/amd64', 'versions': versions}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    result = {key: resolve(ref) for key, ref in IMAGES.items()}
    path = pathlib.Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')

if __name__ == '__main__':
    main()
