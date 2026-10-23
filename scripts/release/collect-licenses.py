#!/usr/bin/env python3
"""Collect notices from actual images; never inspect a running installation.

Outputs only licensing metadata/source, not complete image filesystems.
Final image SBOM generation is a separate release step.
"""
import argparse
import hashlib
import io
import json
import re
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
NATIVE_UNUSED = re.compile(r'(^|/)(sharp|@img)(/|$)|libvips[^/]*\.(?:so|dylib)', re.I)
LICENSE_NAME = re.compile(r'^(licen[cs]e|copying|notice|copyright|third[-_]?party)[^/]*$|\.(?:LICENSE|LEGAL)(?:\.txt)?$', re.I)


def run(*args, **kwargs):
    result = subprocess.run(args, check=True, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, **kwargs)
    return result.stdout


def fetch(url, dest):
    request = urllib.request.Request(url, headers={'User-Agent':'LoveCloud-license-collector/0.1.0'})
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(request, timeout=120) as src, dest.open('wb') as out:
        shutil.copyfileobj(src, out)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def save_member(archive, member, target):
    # Never extract links or paths controlled by an archive. This writes bytes
    # to a derived safe destination and never calls extractall.
    if not member.isfile() or member.size > 32 * 1024 * 1024:
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    with archive.extractfile(member) as src, target.open('wb') as out:
        shutil.copyfileobj(src, out)
    return True


def safe_name(name):
    return re.sub(r'[^A-Za-z0-9._-]', '_', name)


def parse_apk(data):
    packages = []
    for entry in data.split('\n\n'):
        fields = dict(line.split(':', 1) for line in entry.splitlines() if ':' in line)
        if 'P' in fields:
            packages.append({key:fields.get(field, '') for key,field in
                             [('name','P'),('version','V'),('origin','o'),('commit','c'),('license','L')]})
    return packages


def parse_dpkg(data):
    packages = []
    for entry in data.split('\n\n'):
        fields = dict(line.split(': ', 1) for line in entry.splitlines()
                      if ': ' in line and not line.startswith(' '))
        if fields.get('Status') == 'install ok installed':
            source = fields.get('Source', fields['Package'])
            match = re.match(r'([^ ]+)(?: \(([^)]+)\))?', source)
            packages.append({'name':fields['Package'], 'version':fields['Version'],
                             'origin':match[1], 'sourceVersion':match[2] or fields['Version']})
    return packages


def scan_image(role, image, out):
    info = json.loads(run('docker','image','inspect',image))[0]
    image_out = out / role
    image_out.mkdir()
    report = {'image':image,'id':info['Id'],'repoDigests':info.get('RepoDigests',[]),
              'platform':info['Os']+'/'+info['Architecture'], 'labels':info.get('Config',{}).get('Labels',{}),
              'packages':[], 'nativeUnusedFindings':[], 'osPackages':[], 'licenseFiles':[], 'nuget':[]}
    container = run('docker','create',image).decode().strip()
    metadata = {}
    process = None
    try:
        process = subprocess.Popen(['docker','export',container], stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE)
        with tarfile.open(fileobj=process.stdout, mode='r|*') as archive:
            for member in archive:
                name = member.name.lstrip('./')
                parts = PurePosixPath(name).parts
                if '..' in parts: raise RuntimeError('Unsafe image archive path')
                if role == 'frontend' and NATIVE_UNUSED.search(name):
                    report['nativeUnusedFindings'].append(name)
                if not member.isfile(): continue
                leaf = parts[-1]
                app_manifest = leaf == 'package.json' and 'node_modules' in parts
                deps = name.startswith('app/') and name.endswith('.deps.json')
                os_meta = name in ['lib/apk/db/installed','var/lib/dpkg/status','etc/os-release','etc/alpine-release']
                notice = LICENSE_NAME.match(leaf) or '/licenses/' in name or '/legal/' in name
                if not any([app_manifest, deps, os_meta, notice]): continue
                target = image_out / 'files' / name
                if not save_member(archive, member, target): continue
                if notice: report['licenseFiles'].append(name)
                if app_manifest:
                    package = json.loads(target.read_text(encoding='utf-8'))
                    report['packages'].append({key:package.get(key) for key in ['name','version','license','repository']})
                if os_meta: metadata[name] = target.read_text(encoding='utf-8')
                if deps:
                    libs = json.loads(target.read_text(encoding='utf-8')).get('libraries',{})
                    report['nuget'].extend(name for name,entry in libs.items() if entry.get('type') == 'package')
        process.stdout.close()
        error = process.stderr.read()
        if process.wait() != 0: raise RuntimeError('docker export failed: '+error.decode(errors='replace'))
    finally:
        if process and process.poll() is None: process.kill()
        run('docker','rm',container)
    if role in ['api','frontend']:
        for expected in ['LICENSE','NOTICE','THIRD_PARTY_NOTICES']:
            if not (image_out/'files/usr/share/licenses/lovecloud'/expected).is_file():
                raise RuntimeError(role+' image missing /usr/share/licenses/lovecloud/'+expected)
    if report['nativeUnusedFindings']:
        raise RuntimeError('Unused native image stack unexpectedly shipped: '+str(report['nativeUnusedFindings'][:8]))
    report['osRelease'] = metadata.get('etc/os-release','')
    report['osPackages'] = parse_apk(metadata['lib/apk/db/installed']) if 'lib/apk/db/installed' in metadata else parse_dpkg(metadata.get('var/lib/dpkg/status',''))
    report['distribution'] = 'alpine' if 'lib/apk/db/installed' in metadata else 'debian-family'
    (image_out/'image-inventory.json').write_text(json.dumps(report,indent=2)+'\n', encoding='utf-8')
    return report


def scan_layers(image, out):
    # docker export alone cannot prove that a removed binary was not delivered
    # in an earlier layer. Inspect every member of every saved OCI/Docker layer.
    findings = []
    inspected_layers = 0
    process = subprocess.Popen(['docker','image','save',image],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    try:
        with tarfile.open(fileobj=process.stdout, mode='r|*') as outer:
            for layer in outer:
                if not layer.isfile(): continue
                # Current Docker may use blobs/sha256 rather than layer.tar.
                # Probe streams without retaining multi-GB image archives.
                if not (layer.name.endswith('layer.tar') or '/sha256/' in layer.name): continue
                src = outer.extractfile(layer)
                prefix = src.read(512)
                if len(prefix)<512: continue
                if prefix[:2] != b'\x1f\x8b' and prefix[257:262] != b'ustar':
                    continue
                inspected_layers += 1
                class PrefixReader(io.RawIOBase):
                    def __init__(self): self.prefix=io.BytesIO(prefix)
                    def read(self, size=-1):
                        first=self.prefix.read(size)
                        return first+src.read(-1 if size<0 else max(0,size-len(first)))
                with tarfile.open(fileobj=PrefixReader(),mode='r|*') as inner:
                    for item in inner:
                        if NATIVE_UNUSED.search(item.name): findings.append(layer.name+':'+item.name)
        process.stdout.close()
        error = process.stderr.read()
        if process.wait()!=0: raise RuntimeError('docker save failed: '+error.decode(errors='replace'))
    finally:
        if process.poll() is None: process.kill()
    if findings: raise RuntimeError('Unused sharp/libvips exists in image layer: '+str(findings[:8]))
    if inspected_layers == 0: raise RuntimeError('No supported image layers found; layer audit is NOT RUN')
    (out/'frontend-layer-audit.json').write_text(json.dumps({'status':'PASS','image':image,'layersInspected':inspected_layers,'findings':findings},indent=2)+'\n',encoding='utf-8')


def collect_nuget(report, out):
    for entry in sorted(set(report['nuget'])):
        name,version = entry.rsplit('/',1)
        package_out = out/'nuget'/safe_name(name+'-'+version)
        package_out.mkdir(parents=True,exist_ok=True)
        url=f'https://api.nuget.org/v3-flatcontainer/{name.lower()}/{version.lower()}/{name.lower()}.{version.lower()}.nupkg'
        with tempfile.TemporaryDirectory(prefix='lovecloud-nuget-') as temp:
            archive=Path(temp)/'package.zip'
            fetch(url,archive)
            notices=[]
            spec = None
            with zipfile.ZipFile(archive) as package:
                for file in package.infolist():
                    if file.is_dir() or file.file_size>32*1024*1024: continue
                    if LICENSE_NAME.match(PurePosixPath(file.filename).name) or file.filename.endswith('.nuspec'):
                        destination=package_out/safe_name(file.filename)
                        destination.write_bytes(package.read(file))
                        notices.append(destination.name)
                        if file.filename.endswith('.nuspec'): spec = ET.fromstring(package.read(file))
            if not notices: raise RuntimeError('No license metadata found in NuGet '+entry)
            source_urls = []
            # Many Microsoft/Npgsql packages carry only an SPDX expression in
            # the nuspec, not the required copyright/license text itself.
            repository = next((e for e in spec.iter() if e.tag.split('}')[-1]=='repository'),None) if spec is not None else None
            if repository is not None and re.fullmatch(r'[0-9a-f]{40}',repository.get('commit','')):
                repo = repository.get('url','').removesuffix('.git')
                if repo.startswith('https://github.com/'):
                    raw='https://raw.githubusercontent.com/'+repo[len('https://github.com/'):]+'/'+repository.get('commit')+'/'
                    for candidate in ['LICENSE.TXT','LICENSE','LICENSE.txt','LICENSE.md','license.md']:
                        try:
                            fetch(raw+candidate,package_out/'upstream-LICENSE.txt')
                            source_urls.append(raw+candidate)
                            notices.append('upstream-LICENSE.txt')
                            break
                        except urllib.error.HTTPError as error:
                            if error.code != 404: raise
                    for candidate in ['THIRD-PARTY-NOTICES.TXT','THIRD-PARTY-NOTICES.txt']:
                        try:
                            fetch(raw+candidate,package_out/'upstream-THIRD-PARTY-NOTICES.txt')
                            source_urls.append(raw+candidate)
                            notices.append('upstream-THIRD-PARTY-NOTICES.txt')
                            break
                        except urllib.error.HTTPError as error:
                            if error.code != 404: raise
            if not any('license' in file.lower() or 'copying' in file.lower() for file in notices):
                raise RuntimeError('Missing actual NuGet license text: '+entry)
            (package_out/'source.json').write_text(json.dumps({'package':name,'version':version,'url':url,'sha256':digest(archive),'upstreamNoticeURLs':source_urls,'notices':notices},indent=2)+'\n',encoding='utf-8')


ALPINE_FETCH = r'''set -eu
apk add --no-cache alpine-sdk curl >/dev/null
mkdir -p /output/recipes /output/distfiles
while IFS='|' read -r origin version commit; do
  [ -n "$origin" ] || continue
  found=0
  for repo in main community testing; do
    recipe="https://gitlab.alpinelinux.org/alpine/aports/-/archive/$commit/aports-$commit.tar.gz?path=$repo/$origin"
    if curl --fail --location --retry 3 "$recipe" -o /tmp/aports.tar.gz 2>/dev/null; then
      mkdir -p "/output/recipes/$origin" /tmp/lc-source
      tar -xzf /tmp/aports.tar.gz -C /tmp/lc-source
      build=$(find /tmp/lc-source -path "*/$repo/$origin/APKBUILD" -print -quit)
      if [ -n "$build" ]; then
        cp -a "$(dirname "$build")/." "/output/recipes/$origin/"
        (cd "/output/recipes/$origin" && SRCDEST=/output/distfiles abuild -F fetch)
        printf '%s\n' "$recipe" > "/output/recipes/$origin/recipe-url.txt"
        found=1
        break
      fi
    fi
  done
  [ "$found" = 1 ] || { echo "Cannot acquire source recipe for $origin $version" >&2; exit 1; }
done < /output/packages.txt
'''

DEBIAN_FETCH = r'''set -eu
mkdir -p /output/sources
# Retain the signed repositories/suites configured by the exact base image.
if [ -d /etc/apt/sources.list.d ]; then
  for f in /etc/apt/sources.list.d/*.sources; do
    [ -f "$f" ] || continue
    sed 's/^Types: deb$/Types: deb-src/' "$f" > "${f%.sources}-lovecloud-src.sources"
  done
fi
if [ -f /etc/apt/sources.list ]; then
  sed -n 's/^deb /deb-src /p' /etc/apt/sources.list > /etc/apt/sources.list.d/lovecloud-src.list
fi
apt-get update >/dev/null
cd /output/sources
while IFS='|' read -r package version; do
  [ -n "$package" ] || continue
  apt-get source --download-only "$package=$version"
done < /output/packages.txt
'''


def collect_os_sources(role, image, report, out, download):
    target=out/'os-sources'/role
    target.mkdir(parents=True,exist_ok=True)
    packages=[]
    if report['distribution']=='alpine':
        origins={}
        for package in report['osPackages']:
            if not package['origin'] or not package['commit']:
                raise RuntimeError('Alpine package lacks source origin/commit: '+package['name'])
            origins[package['origin']]=package
        packages=['|'.join([p['origin'],p['version'],p['commit']]) for p in sorted(origins.values(),key=lambda p:p['origin'])]
        script=ALPINE_FETCH
    else:
        packages=sorted(set(p['origin']+'|'+p['sourceVersion'] for p in report['osPackages']))
        script=DEBIAN_FETCH
    if not packages: raise RuntimeError('No OS package inventory for '+role)
    (target/'packages.txt').write_text('\n'.join(packages)+'\n',encoding='utf-8')
    (target/'acquire-sources.sh').write_text(script,encoding='utf-8')
    if download:
        subprocess.run(['docker','run','--rm','--user','0','--entrypoint','/bin/sh',
                        '--mount','type=bind,source='+str(target.resolve())+',target=/output',image,'-s'],
                       input=script.encode(),check=True)
    return {'status':'PASS' if download else 'NOT RUN','packages':len(packages),
            'method':'exact aports recipe+abuild fetch' if report['distribution']=='alpine' else 'configured signed apt deb-src exact source versions',
            'location':str(target.relative_to(out))}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--api-image',required=True)
    parser.add_argument('--frontend-image',required=True)
    parser.add_argument('--infrastructure-image',action='append',default=[],metavar='NAME=IMAGE')
    parser.add_argument('--output-dir',required=True)
    parser.add_argument('--fetch-os-sources',action='store_true')
    args=parser.parse_args()
    out=Path(args.output_dir).resolve()
    out.mkdir(parents=True,exist_ok=True)
    if any(out.iterdir()): raise SystemExit('License output directory must be empty.')
    shutil.copytree(ROOT/'licenses',out/'project-licenses')
    for name in ['LICENSE','NOTICE','THIRD_PARTY_NOTICES']:
        shutil.copy2(ROOT/name,out/name)
    images=[('api',args.api_image),('frontend',args.frontend_image)]
    for item in args.infrastructure_image:
        name,image=item.split('=',1)
        if name!=safe_name(name): raise SystemExit('Invalid infrastructure image name')
        images.append((name,image))
    report={'status':'PASS','images':{},'sources':{},'frontendLayerAudit':'NOT RUN'}
    for role,image in images:
        inventory=scan_image(role,image,out)
        report['images'][role]={'image':image,'id':inventory['id'],'licenseFiles':len(inventory['licenseFiles']),'packages':len(inventory['packages'])}
        if role=='api': collect_nuget(inventory,out)
        report['sources'][role]=collect_os_sources(role,image,inventory,out,args.fetch_os_sources)
    scan_layers(args.frontend_image,out)
    report['frontendLayerAudit']='PASS'
    if not args.fetch_os_sources: report['status']='NOT RUN'
    report['files']=[{'path':str(p.relative_to(out)).replace('\\','/'),'sha256':digest(p)}
                     for p in sorted(out.rglob('*')) if p.is_file()]
    (out/'license-report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'status':report['status'],'images':len(images),'files':len(report['files']),'output':str(out)}))


if __name__=='__main__':
    main()
