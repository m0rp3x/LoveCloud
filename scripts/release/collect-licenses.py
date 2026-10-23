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
            package={key:fields.get(field, '') for key,field in
                     [('name','P'),('version','V'),('origin','o'),('commit','c'),('license','L')]}
            package['installedBytes']=int(fields.get('I','-1'))
            package['fileEntries']=sum(line.startswith(('F:','R:')) for line in entry.splitlines())
            package['dependencies']=fields.get('D','').split()
            package['provides']=fields.get('p','').split()
            packages.append(package)
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
                os_meta = name in ['lib/apk/db/installed','var/lib/dpkg/status','etc/os-release','etc/alpine-release'] or name.startswith('etc/apt/sources.list')
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
            (package_out/'source.json').write_text(json.dumps({'package':name,'version':version,'url':url,'sha256':digest(archive),'repository':dict(repository.attrib) if repository is not None else {},'upstreamNoticeURLs':source_urls,'notices':notices},indent=2)+'\n',encoding='utf-8')


def collect_native_sources(report, out):
    # Skia's aggregate preserves historical MPL tri-licensed GIF/mozzconf
    # notices as well as permissive components. Supply immutable native source
    # and build recipes, rather than assuming its managed MIT wrapper is enough.
    package = next((entry for entry in report['nuget'] if entry.startswith('SkiaSharp.NativeAssets.Linux.NoDependencies/')),None)
    if package is None: raise RuntimeError('Expected SkiaSharp native package not found in API deps.json')
    name,version=package.rsplit('/',1)
    metadata=json.loads((out/'nuget'/safe_name(name+'-'+version)/'source.json').read_text(encoding='utf-8'))
    commit=metadata['repository'].get('commit','')
    if not re.fullmatch(r'[0-9a-f]{40}',commit): raise RuntimeError('SkiaSharp NuGet source commit missing')
    target=out/'native-sources/skia'
    target.mkdir(parents=True)
    module_url=f'https://api.github.com/repos/mono/SkiaSharp/contents/externals/skia?ref={commit}'
    fetch(module_url,target/'skia-submodule.json')
    module=json.loads((target/'skia-submodule.json').read_text(encoding='utf-8'))
    skia_commit=module.get('sha','')
    if module.get('submodule_git_url')!='https://github.com/mono/skia.git' or not re.fullmatch(r'[0-9a-f]{40}',skia_commit):
        raise RuntimeError('Unexpected Skia source submodule; review provenance before publishing')
    deps_url=f'https://raw.githubusercontent.com/mono/skia/{skia_commit}/DEPS'
    fetch(deps_url,target/'DEPS')
    deps=(target/'DEPS').read_text(encoding='utf-8')
    match=re.search(r'"third_party/externals/zlib"\s*:\s*"(https://chromium.googlesource.com/[^"@]+)@([0-9a-f]{40})"',deps)
    if not match: raise RuntimeError('Cannot identify exact Skia zlib/mozzconf source')
    sources=[(f'https://codeload.github.com/mono/SkiaSharp/tar.gz/{commit}','skiasharp-build-source.tar.gz'),
             (f'https://codeload.github.com/mono/skia/tar.gz/{skia_commit}','skia-source.tar.gz'),
             (match[1]+'/+archive/'+match[2]+'.tar.gz','zlib-source.tar.gz')]
    inventory=[]
    for url,name in sources:
        fetch(url,target/name)
        # Check it is an actual archive, not an HTML error with status 200.
        with tarfile.open(target/name,'r:gz') as archive:
            if archive.next() is None: raise RuntimeError('Empty native source archive')
        inventory.append({'url':url,'file':name,'sha256':digest(target/name)})
    result={'status':'PASS','nugetPackage':package,'skiasharpCommit':commit,'skiaCommit':skia_commit,'sources':inventory,
            'scope':'Unmodified native source and build recipes, including zlib/mozzconf MPL tri-license source; full upstream notices retained.'}
    (target/'source-provenance.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    return result


def validate_static_nuget_notices(report, out, static=None):
    """Reject SPDX-only/wrapper-only delivery: full runtime notices must ship.

    The actual-image NuGet inventory selects packages. Their retained actual
    license text/copyright must also appear in the static image license bundle,
    either as its own file or inside an upstream aggregate. This is stronger
    than matching an SPDX family while silently dropping a different owner.
    """
    static=Path(static) if static is not None else ROOT/'licenses'
    normalize=lambda text:text.replace('\r\n','\n').strip()
    texts=[normalize(path.read_text(encoding='utf-8-sig')) for path in static.rglob('*.txt')]
    index=json.loads((static/'nuget-license-index.json').read_text(encoding='utf-8'))['packages']
    for package,entry in index.items():
        file=static/entry['file']
        if not file.is_file() or hashlib.sha256(file.read_bytes().replace(b'\r\n',b'\n')).hexdigest()!=entry['sha256']:
            raise RuntimeError('Static NuGet notice provenance/hash mismatch: '+package)
    checks=[]
    for package in sorted(set(report['nuget'])):
        name,version=package.rsplit('/',1)
        directory=out/'nuget'/safe_name(name+'-'+version)
        metadata=json.loads((directory/'source.json').read_text(encoding='utf-8'))
        files=[directory/name for name in metadata['notices'] if 'license' in name.lower()]
        notices=[normalize(file.read_text(encoding='utf-8-sig')) for file in files]
        if not notices or not any(len(notice)>300 and any(notice in text for text in texts) for notice in notices):
            raise RuntimeError('Actual NuGet copyright/license missing from API image bundle: '+package)
        if package.startswith('Npgsql'):
            if package not in index: raise RuntimeError('Exact Npgsql version requires reviewed notice provenance: '+package)
        checks.append({'package':package,'status':'PASS','detail':'Full actual license/copyright retained in static API image bundle; SPDX alone is insufficient.'})
    result={'status':'PASS','checks':checks}
    (out/'static-nuget-notices.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    return result


ALPINE_FETCH = r'''set -eu
apk add --no-cache alpine-sdk curl >/dev/null
mkdir -p /output/recipes /output/distfiles
download_recipe_archive() {
  archive_url=$1
  # Both providers are public, exact-commit official repositories. Keep useful
  # HTTP diagnostics instead of hiding failures behind a generic final error.
  printf 'Fetching exact aports recipe: %s\n' "$archive_url" >&2
  if ! curl --fail --silent --show-error --location --connect-timeout 20 --max-time 180 --retry 3 --retry-delay 3 "$archive_url" -o /tmp/aports.tar.gz; then
    return 1
  fi
  if ! tar -tzf /tmp/aports.tar.gz > /tmp/lc-aports-files.txt; then
    printf 'Invalid aports archive from %s\n' "$archive_url" >&2
    return 1
  fi
}
acquire_recipe_directory() {
  repo=$1
  # Extract only this package's immutable recipe and local patches/data, even
  # when the official GitHub mirror returns a complete aports repository.
  recipe_tree=$(awk -v wanted="/$repo/$origin/" 'index($0,wanted) { print substr($0,1,index($0,wanted)+length(wanted)-1); exit }' /tmp/lc-aports-files.txt)
  [ -n "$recipe_tree" ] || return 1
  rm -rf /tmp/lc-source
  mkdir -p "/output/recipes/$origin" /tmp/lc-source
  tar -xzf /tmp/aports.tar.gz -C /tmp/lc-source "$recipe_tree" || exit 1
  build=$(find /tmp/lc-source -path "*/$repo/$origin/APKBUILD" -print -quit)
  [ -n "$build" ] || return 1
  cp -a "$(dirname "$build")/." "/output/recipes/$origin/" || exit 1
  # Explicit failure is necessary: this function is called from an if clause,
  # where POSIX shells suppress implicit set -e handling inside functions.
  (cd "/output/recipes/$origin" && SRCDEST=/output/distfiles DISTFILES_MIRROR=https://distfiles.alpinelinux.org/distfiles/edge abuild -F fetch && SRCDEST=/output/distfiles abuild -F verify) || exit 1
  printf '%s\n' "$archive_url" > "/output/recipes/$origin/recipe-url.txt"
}
while IFS='|' read -r origin version commit; do
  [ -n "$origin" ] || continue
  case "$origin" in *[!A-Za-z0-9+_.-]*) echo 'Invalid APK source origin.' >&2; exit 1;; esac
  case "$commit" in ''|*[!0-9a-f]*) echo 'APK source requires an exact commit.' >&2; exit 1;; esac
  [ "${#commit}" = 40 ] || { echo 'APK source requires a complete commit.' >&2; exit 1; }
  found=0
  # Prefer the official mirror: canonical GitLab can time out from CI networks.
  # Both providers still require the exact same full Git commit and checksums.
  recipe="https://codeload.github.com/alpinelinux/aports/tar.gz/$commit"
  if download_recipe_archive "$recipe"; then
    for repo in main community testing; do
      if acquire_recipe_directory "$repo"; then
        found=1
        break
      fi
    done
  fi
  if [ "$found" = 0 ]; then
    for repo in main community testing; do
      recipe="https://gitlab.alpinelinux.org/alpine/aports/-/archive/$commit/aports-$commit.tar.gz?path=$repo/$origin"
      if download_recipe_archive "$recipe" && acquire_recipe_directory "$repo"; then
        found=1
        break
      fi
    done
  fi
  [ "$found" = 1 ] || { echo "Cannot acquire source recipe for $origin $version" >&2; exit 1; }
done < /output/packages.txt
rm -rf /tmp/lc-source
rm -f /tmp/aports.tar.gz /tmp/lc-aports-files.txt
printf 'sources-verified\n' > /output/source-fetch-complete.txt
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
mkdir -p /output/repositories /output/source-metadata
cp -a /etc/apt/sources.list.d /output/repositories/
[ ! -f /etc/apt/sources.list ] || cp /etc/apt/sources.list /output/repositories/
cd /output/sources
snapshot_id=20260901T000000Z
snapshot_root=/output/source-metadata/ubuntu-snapshot
snapshot_ready=false
snapshot_apt() {
  apt-get -o Dir::Etc::sourcelist=/dev/null \
    -o Dir::Etc::sourceparts="$snapshot_root/sources.list.d" \
    -o Dir::State::lists="$snapshot_root/lists" \
    "$@" --snapshot "$snapshot_id"
}
prepare_snapshot() {
  [ "$snapshot_ready" = false ] || return 0
  # This dated fallback is Ubuntu-only. Keep the image's current repositories
  # and Signed-By trust roots unchanged; historical indexes live separately.
  grep -Eq '^ID="?ubuntu"?$' /etc/os-release || {
    echo 'Exact source version unavailable; historical fallback supports Ubuntu only.' >&2; exit 1;
  }
  mkdir -p "$snapshot_root/sources.list.d" "$snapshot_root/lists/partial"
  for source in /etc/apt/sources.list.d/*-lovecloud-src.sources; do
    [ -f "$source" ] || continue
    awk -v snapshot="$snapshot_id" 'BEGIN {RS=""; ORS="\n\n"}
      /(^|\n)URIs: [^\n]*https?:\/\/([A-Za-z0-9.-]+\.)?(archive|security|ports)\.ubuntu\.com\/ubuntu(-ports)?\/?([ \n]|$)/ {
        gsub(/(^|\n)Types:[^\n]*/, "\nTypes: deb-src")
        gsub(/(^|\n)Snapshot:[^\n]*/, "")
        print $0 "\nSnapshot: " snapshot
      }' "$source" > "$snapshot_root/sources.list.d/$(basename "$source")"
  done
  # Ubuntu 24.04's official deb822 files retain Signed-By. Do not invent
  # replacement keys or relax APT authentication for an unknown source setup.
  grep -l '^Signed-By:' "$snapshot_root"/sources.list.d/*.sources >/dev/null || {
    echo 'No authenticated Ubuntu source stanza for historical fallback.' >&2; exit 1;
  }
  printf '%s\n' "$snapshot_id" > "$snapshot_root/snapshot-id.txt"
  snapshot_apt update >/dev/null
  snapshot_ready=true
}
while IFS='|' read -r package version; do
  [ -n "$package" ] || continue
  if apt-get source --only-source --print-uris "$package=$version" > "/output/source-metadata/$package-uris.txt"; then
    apt-get source --only-source --download-only "$package=$version"
  else
    # Old base-image packages can disappear from current Sources indexes.
    # The exact same source version must exist in a signed historical index;
    # a missing version still fails and never falls back to the latest source.
    prepare_snapshot
    snapshot_apt source --only-source --print-uris "$package=$version" > "/output/source-metadata/$package-uris.txt"
    snapshot_apt source --only-source --download-only "$package=$version"
  fi
done < /output/packages.txt
# APT's root-only lock/partial workspace is not licensing evidence. These exact
# paths belong only to this disposable helper's private snapshot lists; retain
# every signed index, source file and repository configuration beside them.
if [ "$snapshot_ready" = true ]; then
  rm -f -- /output/source-metadata/ubuntu-snapshot/lists/lock
  rm -rf -- /output/source-metadata/ubuntu-snapshot/lists/partial
fi
printf 'sources-verified\n' > /output/source-fetch-complete.txt
'''


def collect_os_sources(role, image, report, out, download):
    target=out/'os-sources'/role
    target.mkdir(parents=True,exist_ok=True)
    packages=[]
    if report['distribution']=='alpine':
        origins={}
        virtual=[]
        def dependency_name(value): return re.split(r'[<>=~]',value,1)[0]
        providers={}
        for package in report['osPackages']:
            for name in [package['name'],*package.get('provides',[])]:
                providers.setdefault(dependency_name(name),[]).append(package['name'])
        for package in report['osPackages']:
            if not package['origin'] or not package['commit']:
                # `apk add --virtual .postgresql-rundeps ...` creates a local,
                # fileless dependency record. Prove it owns no payload and all
                # dependencies resolve to installed providers; do not skip a
                # real unknown package merely because its metadata is missing.
                dependencies=package.get('dependencies',[])
                if (package['name'].startswith('.') and package['origin'] in ['',package['name']]
                    and not package['commit'] and package.get('installedBytes')==0
                    and package.get('fileEntries')==0 and dependencies
                    and all(dependency_name(dep) in providers and
                            any(name!=package['name'] for name in providers[dependency_name(dep)])
                            for dep in dependencies)):
                    virtual.append({'name':package['name'],'version':package['version'],
                                    'installedBytes':0,'fileEntries':0,'dependencies':dependencies,
                                    'providers':{dep:providers[dependency_name(dep)] for dep in dependencies},
                                    'reason':'Generated fileless APK dependency metapackage; provider packages remain source-audited.'})
                    continue
                raise RuntimeError('Alpine package lacks source origin/commit: '+package['name'])
            origins[package['origin']]=package
        packages=['|'.join([p['origin'],p['version'],p['commit']]) for p in sorted(origins.values(),key=lambda p:p['origin'])]
        (target/'virtual-metapackages.json').write_text(json.dumps(virtual,indent=2)+'\n',encoding='utf-8')
        script=ALPINE_FETCH
    else:
        packages=sorted(set(p['origin']+'|'+p['sourceVersion'] for p in report['osPackages']))
        script=DEBIAN_FETCH
    if not packages: raise RuntimeError('No OS package inventory for '+role)
    (target/'packages.txt').write_text('\n'.join(packages)+'\n',encoding='utf-8')
    (target/'acquire-sources.sh').write_text(script,encoding='utf-8')
    if download:
        subprocess.run(['docker','run','--rm','-i','--user','0','--entrypoint','/bin/sh',
                        '--mount','type=bind,source='+str(target.resolve())+',target=/output',image,'-s'],
                       input=script.encode(),check=True)
        marker=target/'source-fetch-complete.txt'
        if not marker.is_file() or marker.read_text(encoding='utf-8')!='sources-verified\n':
            raise RuntimeError('Source helper did not execute to completion (missing verified marker): '+role)
        if report['distribution']=='alpine':
            for origin in origins:
                if not (target/'recipes'/origin/'APKBUILD').is_file():
                    raise RuntimeError('Missing acquired APK source recipe: '+origin)
            if not any(path.is_file() for path in (target/'distfiles').rglob('*')):
                raise RuntimeError('No acquired source distfiles: '+role)
        elif len(list((target/'sources').glob('*.dsc')))<len(packages):
            raise RuntimeError('Missing acquired Debian source descriptors: '+role)
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
        if role=='api':
            collect_nuget(inventory,out)
            report['staticNugetNotices']=validate_static_nuget_notices(inventory,out,out/'api/files/usr/share/licenses/lovecloud/licenses')
            report['nativeSources']=collect_native_sources(inventory,out)
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
