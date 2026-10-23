"""Offline evidence validation; actual acquisition is a separate Docker probe."""
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('os_source_probe',Path(__file__).with_name('os-source-probe.py'))
probe=importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class SourceEvidenceChecks(unittest.TestCase):
    def test_official_gitlab_and_github_exact_commit_archives_pass(self):
        commit='a'*40
        for uri in [f'https://gitlab.alpinelinux.org/alpine/aports/-/archive/{commit}/aports-{commit}.tar.gz?path=main/busybox',
                    f'https://github.com/alpinelinux/aports/archive/{commit}.tar.gz',
                    f'https://codeload.github.com/alpinelinux/aports/tar.gz/{commit}']:
            with self.subTest(uri=uri):self.assertIn('official Alpine',probe.verify_aports_provenance(uri,commit))

    def test_aports_unknown_host_owner_or_wrong_commit_fails(self):
        commit='a'*40
        uris=[f'https://example.test/alpinelinux/aports/archive/{commit}.tar.gz',
              f'https://github.com.example.test/alpinelinux/aports/archive/{commit}.tar.gz',
              f'https://github.com/unrelated/aports/archive/{commit}.tar.gz',
              'https://github.com/alpinelinux/aports/archive/'+('b'*40)+'.tar.gz',
              'https://github.com/alpinelinux/aports/archive/master.tar.gz',
              f'http://github.com/alpinelinux/aports/archive/{commit}.tar.gz',
              f'https://gitlab.alpinelinux.org/alpine/aports/-/archive/{commit}/aports-{commit}.tar.gz?path=main/unrelated',
              f'https://gitlab.alpinelinux.org/alpine/aports/-/archive/{commit}/aports-{commit}.tar.gz?path=main/busybox&path=testing/unrelated']
        for uri in uris:
            with self.subTest(uri=uri),self.assertRaises(AssertionError):probe.verify_aports_provenance(uri,commit)

    def test_probe_images_are_complete_immutable_references(self):
        for image in [probe.IMAGE,probe.NODE_IMAGE]:
            self.assertRegex(image,r'^.+@sha256:[0-9a-f]{64}$')

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='lovecloud-source-evidence-')
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        for directory in ['sources','repositories','source-metadata']:(self.root/directory).mkdir()
        (self.root/'source-fetch-complete.txt').write_text('sources-verified\n')
        self.orig=self.root/'sources/systemd_255.4.orig.tar.gz'
        self.patches=self.root/'sources/systemd_255.4-1ubuntu8.17.debian.tar.xz'
        self.orig.write_bytes(b'synthetic-original')
        self.patches.write_bytes(b'synthetic-distribution-patches')
        hashes=''.join(' '+hashlib.sha256(file.read_bytes()).hexdigest()+' '+str(file.stat().st_size)+' '+file.name+'\n' for file in [self.orig,self.patches])
        self.descriptor=self.root/'sources/systemd_255.4-1ubuntu8.17.dsc'
        self.descriptor.write_text('Format: 3.0 (quilt)\nSource: systemd\nVersion: '+probe.VERSION+'\nChecksums-Sha256:\n'+hashes)
        (self.root/'source-metadata/systemd-uris.txt').write_text(probe.SNAPSHOT+'pool/main/s/systemd/systemd_255.4-1ubuntu8.17.dsc\n')
        (self.root/'repositories/snapshot.sources').write_text('Types: deb-src\nURIs: '+probe.SNAPSHOT+'\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n')

    def test_exact_version_complete_checksummed_sources_pass(self):
        self.assertEqual(len(probe.verify_payload(self.root)),3)

    def test_latest_substitution_is_rejected(self):
        self.descriptor.write_text(self.descriptor.read_text().replace(probe.VERSION,'999.0-latest'))
        with self.assertRaisesRegex(AssertionError,'Never substitute the latest'):
            probe.verify_payload(self.root)

    def test_corrupt_or_missing_corresponding_source_is_rejected(self):
        self.orig.write_bytes(b'tampered')
        with self.assertRaisesRegex(AssertionError,'Missing complete|checksum mismatch'):
            probe.verify_payload(self.root)

    def test_snapshot_mention_only_in_script_is_not_provenance(self):
        for directory in ['repositories','source-metadata']:
            for file in (self.root/directory).iterdir():file.write_text('not a historical source reference\n')
        (self.root/'acquire-sources.sh').write_text(probe.SNAPSHOT)
        with self.assertRaisesRegex(AssertionError,'Actual historical snapshot URI provenance'):
            probe.verify_payload(self.root)

    def test_repository_without_retained_authentication_configuration_fails(self):
        (self.root/'repositories/snapshot.sources').write_text('URIs: '+probe.SNAPSHOT+'\n')
        with self.assertRaisesRegex(AssertionError,'authenticated Ubuntu repository'):
            probe.verify_payload(self.root)

    def test_missing_completion_cannot_pass(self):
        (self.root/'source-fetch-complete.txt').write_text('started\n')
        with self.assertRaisesRegex(AssertionError,'completion marker'):
            probe.verify_payload(self.root)

    def test_unreadable_retained_evidence_is_not_silently_ignored(self):
        evidence=self.root/'source-metadata/retained-evidence.txt'
        evidence.write_text('retained evidence\n')
        original=Path.read_text
        def read(path,*args,**kwargs):
            if path==evidence:raise PermissionError('fixture unreadable retained evidence')
            return original(path,*args,**kwargs)
        with patch.object(Path,'read_text',read):
            with self.assertRaisesRegex(PermissionError,'unreadable retained evidence'):
                probe.verify_payload(self.root)


if __name__=='__main__':unittest.main(verbosity=2)
