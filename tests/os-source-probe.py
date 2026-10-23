"""Actual isolated Linux Docker probe for one historical Ubuntu source version.

This certifies only systemd's exact source acquisition, not the complete OS
inventory. It intentionally uses the public pinned API runtime base from the
second candidate's build-inputs.json, so no candidate image rebuild is needed.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import tempfile
import time
import uuid
from urllib.parse import urlsplit, parse_qs
from unittest.mock import patch

IMAGE = 'mcr.microsoft.com/dotnet/aspnet@sha256:f879b8a9cb3f6694b8b0c9fa530eb0c39d8920db09c05a7edbd6c4c6c104ae1b'
NODE_IMAGE = 'node@sha256:1200d815de24f8dcca745fbf7651d166034a35adbcad8860a8538ffff44f1420'
VERSION = '255.4-1ubuntu8.17'
SNAPSHOT = 'https://snapshot.ubuntu.com/ubuntu/20260901T000000Z/'
ROOT = Path(__file__).resolve().parents[1]


def verify_aports_provenance(value, commit, origin='busybox'):
    """Accept immutable archive URLs from the two official aports providers."""
    assert re.fullmatch(r'[0-9a-f]{40}',commit), 'Exact aports commit required.'
    url=urlsplit(value.strip())
    assert url.scheme=='https' and not url.fragment and not url.username and not url.password, 'Official HTTPS aports archive required.'
    if url.netloc=='gitlab.alpinelinux.org':
        assert url.path==f'/alpine/aports/-/archive/{commit}/aports-{commit}.tar.gz', 'Exact aports commit archive path required.'
        query=parse_qs(url.query)
        assert set(query)=={'path'} and query['path'] in [[f'{repo}/{origin}'] for repo in ['main','community','testing']], 'Exact aports recipe subtree required.'
        return 'official Alpine GitLab'
    if url.netloc=='github.com':
        assert url.path==f'/alpinelinux/aports/archive/{commit}.tar.gz' and not url.query, 'Exact official GitHub aports commit archive required.'
        return 'official Alpine GitHub mirror'
    if url.netloc=='codeload.github.com':
        assert url.path==f'/alpinelinux/aports/tar.gz/{commit}' and not url.query, 'Exact official GitHub aports commit archive required.'
        return 'official Alpine GitHub mirror'
    raise AssertionError('Unrecognized aports archive provider.')


def acquire(collector, image, output, version, role, inventory=None):
    name = 'lc000-source-probe-' + uuid.uuid4().hex
    original_run = subprocess.run

    def bounded(args, **kwargs):
        if args[:2] != ['docker', 'run']:
            raise AssertionError('Probe expects only one disposable Docker source helper.')
        args = args[:2] + ['--name', name] + args[2:]
        return original_run(args, timeout=600, **kwargs)

    if inventory is None:
        inventory = {'distribution': 'debian', 'osPackages': [{'name': 'systemd', 'version': version,
                     'origin': 'systemd', 'sourceVersion': version}]}
    try:
        with patch.object(collector.subprocess, 'run', side_effect=bounded):
            return collector.collect_os_sources(role, image, inventory, output, download=True)
    finally:
        # Only this uniquely named probe container can be removed, including
        # after a timeout disconnects the Docker client from its helper.
        original_run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL, timeout=30, check=False)


def verify_payload(target):
    marker = target / 'source-fetch-complete.txt'
    assert marker.read_text() == 'sources-verified\n', 'Verified completion marker required.'
    descriptors = list((target / 'sources').glob('*.dsc'))
    assert len(descriptors) == 1, 'Exactly one systemd source descriptor expected.'
    text = descriptors[0].read_text(encoding='utf-8')
    assert re.search(r'^Source: systemd\s*$', text, re.M), 'Exact source package required.'
    assert re.search(r'^Version: ' + re.escape(VERSION) + r'\s*$', text, re.M), 'Never substitute the latest version.'
    match = re.search(r'^Checksums-Sha256:\n((?:[ \t].+\n)+)', text, re.M)
    assert match, 'Source descriptor must provide SHA256 for corresponding archives.'
    with descriptors[0].open('rb') as stream:
        descriptor_hash=hashlib.file_digest(stream,'sha256').hexdigest()
    artifacts = [{'name':descriptors[0].name,'sha256':descriptor_hash,'bytes':descriptors[0].stat().st_size}]
    for line in match[1].splitlines():
        digest, size, name = line.split()
        assert Path(name).name == name, 'Descriptor filenames must be simple basenames.'
        file = target / 'sources' / name
        assert file.is_file() and file.stat().st_size == int(size), 'Missing complete corresponding source: ' + name
        with file.open('rb') as stream:
            actual_hash=hashlib.file_digest(stream,'sha256').hexdigest()
        assert actual_hash == digest, 'Corresponding source checksum mismatch: ' + name
        artifacts.append({'name': name, 'sha256': digest, 'bytes': int(size)})
    assert any('.orig.tar.' in item['name'] for item in artifacts), 'Original upstream source archive required.'
    assert any('.debian.tar.' in item['name'] for item in artifacts), 'Exact distribution patches/recipes required.'
    # Inspect runtime-produced acquisition evidence, never the helper's script
    # text: merely mentioning the snapshot in code is not proof it was used.
    evidence = []
    for directory in ['source-metadata', 'repositories']:
        for file in (target / directory).rglob('*'):
            if file.is_file() and file.stat().st_size < 2 * 1024 * 1024:
                evidence.append(file.read_text(encoding='utf-8', errors='replace'))
    assert any(SNAPSHOT in value for value in evidence), 'Actual historical snapshot URI provenance required.'
    assert any('Signed-By:' in value and 'ubuntu-archive-keyring.gpg' in value for value in evidence), 'Retained authenticated Ubuntu repository configuration required.'
    return artifacts


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--probe', choices=['ubuntu','alpine'], default='ubuntu')
    parser.add_argument('--alpine-package', choices=['busybox','apk-tools'], default='busybox')
    parser.add_argument('--image')
    parser.add_argument('--report', default=str(ROOT / '.artifacts/os-source-probe.json'))
    args = parser.parse_args()
    args.image=args.image or (NODE_IMAGE if args.probe=='alpine' else IMAGE)
    assert re.fullmatch(r'.+@sha256:[0-9a-f]{64}',args.image), 'Probe images must be complete immutable registry references.'
    report = {'sourceSha': os.environ.get('GITHUB_SHA'), 'image': args.image,
              'package': args.alpine_package if args.probe=='alpine' else 'systemd', 'version': None if args.probe=='alpine' else VERSION,
              'scope': 'one actual Alpine source origin only' if args.probe=='alpine' else 'one historical Ubuntu source only', 'checks': []}
    path = Path(args.report).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    if platform.system() != 'Linux':
        report['checks'].append({'name': 'real Linux Docker source probe', 'status': 'NOT RUN',
                                 'detail': 'Requires Linux amd64 Docker; this host is ' + platform.system()})
        path.write_text(json.dumps(report, indent=2) + '\n')
        print('NOT RUN real Linux Docker source probe on ' + platform.system())
        return
    started = time.monotonic()
    try:
        subprocess.run(['docker', 'pull', args.image], check=True, timeout=300)
        actual = subprocess.check_output(['docker', 'image', 'inspect', '--format', '{{.Os}}/{{.Architecture}}', args.image], text=True, timeout=30).strip()
        assert actual == 'linux/amd64', 'Probe requires actual Linux amd64 runtime image.'
        spec = importlib.util.spec_from_file_location('probe_collector', ROOT / 'scripts/release/collect-licenses.py')
        collector = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(collector)
        output = Path(tempfile.mkdtemp(prefix='lovecloud-source-probe-'))
        if args.probe=='alpine':
            installed=subprocess.check_output(['docker','run','--rm','--entrypoint','cat',args.image,'/lib/apk/db/installed'],text=True,timeout=90)
            package=next(package for package in collector.parse_apk(installed) if package['name']==args.alpine_package)
            assert package['origin']==args.alpine_package and re.fullmatch('[0-9a-f]{40}',package['commit']), 'Actual APK source origin/commit required.'
            report['version']=package['version'];report['sourceCommit']=package['commit']
            role='alpine-'+args.alpine_package
            result=acquire(collector,args.image,output,package['version'],role,{'distribution':'alpine','osPackages':[package]})
            assert result['status']=='PASS'
            target=output/'os-sources'/role
            assert (target/'source-fetch-complete.txt').read_text()=='sources-verified\n'
            recipe=target/'recipes'/package['origin']/'APKBUILD'
            recipe_text=recipe.read_text()
            package_version=re.search(r'^pkgver=([^\n]+)',recipe_text,re.M)[1].strip("'\"")
            package_release=re.search(r'^pkgrel=([^\n]+)',recipe_text,re.M)[1].strip("'\"")
            assert package['version']==package_version+'-r'+package_release, 'Recipe must match actual installed APK version.'
            provenance=(recipe.parent/'recipe-url.txt').read_text()
            provider=verify_aports_provenance(provenance,package['commit'],package['origin'])
            artifacts=[]
            for file in (target/'distfiles').rglob('*'):
                if file.is_file():
                    with file.open('rb') as stream: digest=hashlib.file_digest(stream,'sha256').hexdigest()
                    artifacts.append({'name':file.name,'sha256':digest,'bytes':file.stat().st_size})
            assert artifacts, 'Actual abuild-fetched and checksum-verified distfiles required.'
            report['checks'].append({'name':'actual Alpine '+args.alpine_package+' exact aports fetch and verify','status':'PASS','recipe':provenance.strip(),'recipeProvider':provider,'artifacts':artifacts})
            print('PASS real Linux Docker Alpine probe: installed '+args.alpine_package+' exact version+aports commit, source recipe, abuild fetch/verify and completion marker.')
            return
        result = acquire(collector, args.image, output, VERSION, 'historical')
        assert result['status'] == 'PASS'
        artifacts = verify_payload(output / 'os-sources/historical')
        report['checks'].append({'name': 'exact authenticated historical source acquisition', 'status': 'PASS',
                                 'snapshot': SNAPSHOT, 'artifacts': artifacts})
        invalid = '0.0.0-lovecloud-nonexistent-version'
        try:
            acquire(collector, args.image, output, invalid, 'missing-exact-version')
        except (subprocess.CalledProcessError, RuntimeError):
            assert not (output / 'os-sources/missing-exact-version/source-fetch-complete.txt').exists(), 'A failed acquisition must not claim completion.'
        else:
            raise AssertionError('Unavailable exact version unexpectedly succeeded; latest-version substitution forbidden.')
        report['checks'].append({'name': 'unavailable exact version fails without completion', 'status': 'PASS'})
        print('PASS real Linux Docker probe: exact signed-snapshot systemd source, original+distribution source SHA256; missing exact version fails closed.')
    except Exception as error:
        report['checks'].append({'name': 'real Linux Docker source probe', 'status': 'FAIL', 'detail': str(error)})
        raise
    finally:
        report['elapsedSeconds'] = round(time.monotonic() - started, 2)
        path.write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
