#!/usr/bin/env python3
"""Remove only explicitly identified test images from failed or cancelled runs.

LOVECLOUD_REJECTED_CANDIDATES is optional repository-variable JSON, with records
{package, digest, sourceSha, runId}. Never infer rejection from tag age alone.
GitHub retains deleted package versions for recovery for 30 days.
"""
import argparse
import json
import os
import pathlib
import re
import urllib.request


def eligible(record, version, keep):
    return (record['digest'] != keep and version['name'] == record['digest']
            and version.get('metadata', {}).get('container', {}).get('tags')
            == ['sha-' + record['sourceSha']])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True)
    args = parser.parse_args()
    manifest = json.loads(pathlib.Path(args.manifest).read_text())
    records = json.loads(os.environ.get('LOVECLOUD_REJECTED_CANDIDATES') or '[]')
    token = os.environ['GH_TOKEN']
    repository = 'm0rp3x/LoveCloud'

    def api(path, method='GET'):
        request = urllib.request.Request('https://api.github.com/' + path, method=method,
            headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
                     'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'LoveCloud-release'})
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response) if response.status != 204 else None

    for record in records:
        package = record['package']
        if package not in ['lovecloud-api', 'lovecloud-frontend']:
            raise RuntimeError('Rejected image must belong to a LoveCloud package')
        if not re.fullmatch(r'sha256:[0-9a-f]{64}', record['digest']) or not re.fullmatch(r'[0-9a-f]{40}', record['sourceSha']):
            raise RuntimeError('Exact rejected digest/source SHA required')
        if not isinstance(record['runId'], int) or record['sourceSha'] == manifest['sourceSha']:
            raise RuntimeError('Refusing to remove the current release candidate')
        run = api(f'repos/{repository}/actions/runs/{record["runId"]}')
        if (run['head_sha'] != record['sourceSha'] or run['path'] != '.github/workflows/release.yml'
                or run['status'] != 'completed' or run['conclusion'] not in {'failure', 'cancelled'}):
            raise RuntimeError('The explicitly rejected release run must have failed or been cancelled')
        base = 'users/m0rp3x/packages/container/' + package
        info = api(base)
        if (info.get('repository') or {}).get('full_name') != repository:
            raise RuntimeError('Package is not linked to this repository')
        matches = []
        for page in range(1, 11):
            versions = api(base + f'/versions?per_page=100&page={page}')
            matches += [v for v in versions if v['name'] == record['digest']]
            if len(versions) < 100:
                break
        else:
            raise RuntimeError('Incomplete package inventory; refusing cleanup')
        key = 'api' if package == 'lovecloud-api' else 'frontend'
        keep = manifest['images'][key]['digest']
        for version in matches:
            if not eligible(record, version, keep):
                raise RuntimeError('Refusing cleanup of a retained or differently tagged version')
            api(base + '/versions/' + str(version['id']), 'DELETE')
            print('Removed rejected test candidate ' + package + '@' + record['digest'])
        if not matches:
            print('Rejected test candidate already absent: ' + package + '@' + record['digest'])


if __name__ == '__main__':
    main()
