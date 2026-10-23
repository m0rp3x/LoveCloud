"""Offline vendor-source guards; actual source acquisition is a separate Docker probe."""
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
COLLECTOR = Path(os.environ.get('LOVECLOUD_COLLECTOR_PATH', ROOT / 'scripts/release/collect-licenses.py'))
spec = importlib.util.spec_from_file_location('vendor_collector', COLLECTOR)
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


class NginxVendorSources(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='lovecloud-vendor-fixture-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.review = copy.deepcopy(collector.nginx_catalog()[1])
        self.image = self.review['imageReference']
        self.packages = [dict(name=p['name'], version=p['version'], origin=p['origin'],
                              license=p['apkLicense'], commit='', installedBytes=10,
                              fileEntries=2) for p in self.review['packages']]
        self.catalog = self.base / 'review.json'
        self.save()

    def save(self):
        self.catalog.write_text(json.dumps(self.review), encoding='utf-8')

    def archive(self, path, members):
        with tarfile.open(path, 'w:gz') as archive:
            for name, content in members.items():
                data = content.encode() if isinstance(content, str) else content
                info = tarfile.TarInfo(name)
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))

    def fixture(self, missing_notice=False, selection=False):
        """Synthetic bytes test control flow, never stand in for upstream evidence."""
        self.cache = self.base / 'cache'
        self.cache.mkdir()
        crate = self.cache / 'fixture-1.0.0.crate'
        metadata = ('[package]\nname="fixture"\nversion="1.0.0"\n'
                    'license="Apache-2.0 OR MIT"\nauthors=["Fixture Author"]\n')
        members = {'fixture-1.0.0/Cargo.toml': metadata}
        if not missing_notice:
            members['fixture-1.0.0/LICENSE'] = 'Synthetic license fixture\n' * 30
        self.archive(crate, members)
        checksum = collector.digest(crate)
        lock = ('[[package]]\nname="fixture"\nversion="1.0.0"\nsource="' +
                self.review['cargo']['registry'] + '"\nchecksum="' + checksum + '"\n')
        self.review['cargo']['licenseSelections'] = []
        if selection:
            self.review['cargo']['licenseSelections'] = [dict(
                name='fixture', version='1.0.0', checksum=checksum,
                declaredLicense='Apache-2.0 OR MIT', selectedLicense='Apache-2.0',
                metadataMember='fixture-1.0.0/Cargo.toml', licenseFile='licenses/Apache-2.0.txt',
                licenseSha256=collector.digest(ROOT/'licenses/Apache-2.0.txt'))]
        packaging = {}
        for source in self.review['sources'][1:]:
            data = {source['licenseMember']: 'Synthetic upstream license fixture\n' * 30}
            if source['id'] == 'acme': data[self.review['cargo']['lockMember']] = lock
            file = self.cache / source['file']
            self.archive(file, data)
            source['sha256'] = collector.digest(file)
            source['sha512'] = hashlib.sha512(file.read_bytes()).hexdigest()
            packaging[source['pkgOssChecksumMember']] = source['sha512']+'  '+source['file']+'\n'
        for member in self.review['packaging']['requiredMembers']:
            packaging[self.review['packaging']['root']+'/'+member] = 'synthetic recipe/patch\n'
        self.actual = self.base / 'image-licenses'
        for p in self.review['packages']:
            data = 'Synthetic distributed COPYRIGHT fixture\n' * 30
            packaging[p['copyrightMember']] = data
            path = self.actual / p['name'] / 'COPYRIGHT'
            path.parent.mkdir(parents=True)
            path.write_text(data)
        source = self.review['sources'][0]
        packaging[source['licenseMember']] = 'Synthetic packaging license fixture\n' * 30
        file = self.cache / source['file']
        self.archive(file, packaging)
        source['sha256'] = collector.digest(file)
        self.save()

    def download(self, url, target):
        source = next((p for p in self.review['sources'] if p['url'] == url), None)
        file = self.cache / (source['file'] if source else url.rsplit('/', 1)[-1])
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(file, target)

    def collect(self):
        with patch.object(collector, 'fetch', self.download):
            return collector.collect_nginx_vendor_sources(self.image, self.packages,
                self.base/'out', self.actual, catalog=self.catalog)

    def test_only_reviewed_exact_image_matches(self):
        self.assertEqual(len(collector.select_nginx_vendor_packages(self.image, self.packages)), 6)
        self.assertEqual(collector.select_nginx_vendor_packages('nginx@sha256:'+'a'*64, self.packages), [])

    def test_versions_raw_license_origin_and_real_payload_are_required(self):
        for field, value in [('version', '1.0'), ('license', 'Apache-2.0'), ('origin', ''),
                             ('commit', 'a'*40), ('installedBytes', 0), ('fileEntries', 0)]:
            with self.subTest(field=field):
                packages = copy.deepcopy(self.packages)
                packages[0][field] = value
                with self.assertRaisesRegex(RuntimeError, 'identity/payload mismatch'):
                    collector.select_nginx_vendor_packages(self.image, packages)

    def test_success_requires_hashes_copyright_sources_and_marker(self):
        self.fixture()
        result = self.collect()
        self.assertEqual(result['status'], 'PASS')
        self.assertEqual(result['cargoRegistrySources'], 1)
        self.assertEqual((self.base/'out/source-fetch-complete.txt').read_text(), 'vendor-sources-verified\n')
        self.assertTrue(any('quickjs.makefile.patch' in p['file'] for p in result['sources']))
        self.assertTrue(any(p.get('sourceFile', '').endswith('nginx-acme-0.4.1.tar.gz') for p in result['licenses']))

    def test_tampered_archive_fails_before_marker(self):
        self.fixture()
        with (self.cache/self.review['sources'][0]['file']).open('ab') as f: f.write(b'tamper')
        with self.assertRaisesRegex(RuntimeError, 'SHA256 mismatch'): self.collect()
        self.assertFalse((self.base/'out/source-fetch-complete.txt').exists())

    def test_changed_actual_copyright_fails(self):
        self.fixture()
        (self.actual/'nginx/COPYRIGHT').write_text('different')
        with self.assertRaisesRegex(RuntimeError, 'COPYRIGHT differs'): self.collect()

    def test_uncatalogued_missing_notice_fails(self):
        self.fixture(missing_notice=True)
        with self.assertRaisesRegex(RuntimeError, 'lacks retained license'): self.collect()
        self.assertFalse((self.base/'out/source-fetch-complete.txt').exists())

    def test_exact_alternative_retains_original_authors_and_full_terms(self):
        self.fixture(missing_notice=True, selection=True)
        result = self.collect()
        metadata = self.base/'out/licenses/cargo/fixture-1.0.0/Cargo.toml'
        self.assertIn('Fixture Author', metadata.read_text())
        terms = self.base/'out/licenses/cargo/fixture-1.0.0/LICENSE-Apache-2.0.txt'
        self.assertEqual(terms.read_bytes(), (ROOT/'licenses/Apache-2.0.txt').read_bytes())
        self.assertEqual(result['status'], 'PASS')

    def test_alternative_with_wrong_checksum_still_fails(self):
        self.fixture(missing_notice=True, selection=True)
        self.review['cargo']['licenseSelections'][0]['checksum'] = 'a'*64
        self.save()
        with self.assertRaisesRegex(RuntimeError, 'lacks retained license'): self.collect()

    def test_alternative_with_changed_terms_fails(self):
        self.fixture(missing_notice=True, selection=True)
        self.review['cargo']['licenseSelections'][0]['licenseSha256'] = 'a'*64
        self.save()
        with self.assertRaisesRegex(RuntimeError, 'alternative mismatch'): self.collect()


if __name__ == '__main__':
    unittest.main(verbosity=2)
