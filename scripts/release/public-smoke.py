#!/usr/bin/env python3
"""Install anonymously downloaded published assets; never touch an operator install."""
import argparse
import hashlib
import json
import os
import pathlib
import re
import subprocess
import tarfile
import tempfile
import time
import urllib.request
import uuid

def digest(path):
    return hashlib.file_digest(path.open('rb'), 'sha256').hexdigest()

def download(url, target):
    # No credentials, auth headers, Git client or gh CLI are used for downloads.
    for attempt in range(12):
        try:
            with urllib.request.urlopen(url, timeout=60) as response, target.open('wb') as file:
                while block := response.read(1024 * 1024):
                    file.write(block)
            return
        except Exception:
            if attempt == 11:
                raise
            time.sleep(5)

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--expected-manifest', required=True)
    p.add_argument('--source-sha', required=True)
    p.add_argument('--report', required=True)
    a = p.parse_args()
    if not re.fullmatch(r'[0-9a-f]{40}', a.source_sha):
        p.error('Complete release SHA required')
    expected_path = pathlib.Path(a.expected_manifest).resolve()
    expected = json.loads(expected_path.read_text())
    if expected['sourceSha'] != a.source_sha:
        raise RuntimeError('Wrong source revision')
    report_path = pathlib.Path(a.report).resolve()
    report = {'sourceSha': a.source_sha, 'version': expected['version'], 'checks': [], 'images': {k: expected['images'][k]['reference'] for k in ['api', 'frontend']}}
    project = 'lc000-public-smoke-' + uuid.uuid4().hex[:10]
    stage = pathlib.Path(tempfile.mkdtemp(prefix='lovecloud-public-smoke-'))
    install = stage / 'install'
    docker_config = stage / 'empty-docker-config'
    docker_config.mkdir(mode=0o700)
    env = dict(os.environ, DOCKER_CONFIG=str(docker_config))
    for key in ['GH_TOKEN', 'GITHUB_TOKEN', 'COMPOSE_PROJECT_NAME', 'COMPOSE_FILE', 'COMPOSE_PATH_SEPARATOR', 'APP_ORIGIN', 'SECURE_COOKIES', 'LOVE_CLOUD_BIND', 'LOVE_CLOUD_PORT', 'COMPOSE_PROFILES']:
        env.pop(key, None)
    def run(*args, capture=False):
        return subprocess.check_output(args, cwd=install, env=env, text=True) if capture else subprocess.run(args, cwd=install, env=env, check=True)
    try:
        archive_name = 'lovecloud-v' + expected['version'] + '-install.tar.gz'
        base = 'https://github.com/m0rp3x/LoveCloud/releases/download/v' + expected['version'] + '/'
        for name in ['SHA256SUMS', 'release-manifest.json', archive_name]:
            download(base + name, stage / name)
        downloaded = stage / 'release-manifest.json'
        if digest(downloaded) != digest(expected_path):
            raise RuntimeError('Published release manifest differs from the accepted manifest')
        sums = dict((line.split()[1], line.split()[0]) for line in (stage / 'SHA256SUMS').read_text().splitlines())
        for name in ['release-manifest.json', archive_name]:
            if digest(stage / name) != sums.get(name):
                raise RuntimeError('Published SHA256SUMS mismatch: ' + name)
        actual_archive = next(x for x in expected['artifacts'] if x['name'] == archive_name)
        if digest(stage / archive_name) != actual_archive['sha256']:
            raise RuntimeError('Published archive differs from verified candidate')
        report['checks'].append({'name': 'public assets and exact checksums', 'status': 'PASS', 'detail': 'Anonymous HTTPS release downloads match the accepted manifest and candidate archive byte for byte.'})
        install.mkdir()
        prefix = 'lovecloud-v' + expected['version']
        with tarfile.open(stage / archive_name, 'r:gz') as archive:
            for member in archive:
                parts = pathlib.PurePosixPath(member.name).parts
                if not parts or parts[0] != prefix or '..' in parts or member.name.startswith('/'):
                    raise RuntimeError('Invalid installation archive path')
                relative = pathlib.Path(*parts[1:])
                if any(x in ['.env', '.secrets', '.artifacts', 'backend', 'frontend', 'node_modules', 'backups'] for x in relative.parts):
                    raise RuntimeError('Unexpected private/source payload')
                target = install / relative
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                elif member.isfile():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(archive.extractfile(member).read())
                    target.chmod(member.mode & 0o777)
                else:
                    raise RuntimeError('Links/special files are not permitted')
        (install / '.env').write_text("COMPOSE_PROJECT_NAME='" + project + "'\nLOVE_CLOUD_PORT='33217'\nLOVE_CLOUD_BIND='127.0.0.1'\nAPP_ORIGIN='http://localhost:33217'\nSECURE_COOKIES='false'\n")
        run('sh', 'scripts/init.sh', '--start', '--quiet-secrets', '--project', project)
        config = json.loads(run('docker', 'compose', 'config', '--format', 'json', capture=True))
        if config['name'] != project or any('build' in s for s in config['services'].values()):
            raise RuntimeError('Wrong isolated project or inherited source build')
        for key in ['api', 'frontend']:
            if config['services'][key]['image'] != report['images'][key]:
                raise RuntimeError('Public installer selected another image')
        with urllib.request.urlopen('http://127.0.0.1:33217/api/v1/setup/status', timeout=30) as response:
            status = json.load(response)
        if status.get('required') is not True:
            raise RuntimeError('Fresh public installation did not reach setup')
        report['checks'].append({'name': 'anonymous archive installation ready', 'status': 'PASS', 'detail': 'Fresh directory, empty Docker credentials, no app source, pull/no-build, exact pinned images and initial setup ready.'})
    except Exception as error:
        report['checks'].append({'name': 'public installation smoke', 'status': 'FAIL', 'detail': str(error)})
        raise
    finally:
        try:
            if (install / '.env').exists():
                # Only this new explicitly named disposable project is affected.
                if not project.startswith('lc000-public-smoke-'):
                    raise RuntimeError('Refusing non-test cleanup')
                run('docker', 'compose', '--project-name', project, '-f', 'compose.yaml', '-f', 'compose.images.yaml', 'down', '-v', '--remove-orphans')
        except Exception:
            report['checks'].append({'name': 'disposable public-install cleanup', 'status': 'FAIL', 'detail': 'Inspect the ephemeral workflow runner; no operator project was selected.'})
            raise
        finally:
            report_path.parent.mkdir(parents=True, exist_ok=True)
            report_path.write_text(json.dumps(report, indent=2) + '\n')

if __name__ == '__main__':
    main()
