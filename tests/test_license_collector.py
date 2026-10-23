"""Offline regression tests: mocked Docker execution is never a runtime claim."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
COLLECTOR = Path(os.environ.get('LOVECLOUD_COLLECTOR_PATH', ROOT / 'scripts/release/collect-licenses.py'))
spec = importlib.util.spec_from_file_location('lovecloud_license_collector', COLLECTOR)
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


class LicenseCollectorChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='lovecloud-license-test-')
        self.addCleanup(self.temp.cleanup)
        self.out = Path(self.temp.name)
        self.report = {'distribution': 'alpine', 'osPackages': collector.parse_apk(
            (ROOT / 'tests/fixtures/postgres18-apk-metadata.txt').read_text(encoding='utf-8'))}

    def collect(self, report=None, download=False):
        return collector.collect_os_sources('db', 'fixture-image@sha256:' + 'a' * 64,
                                            report or self.report, self.out, download)

    def helper(self, args, input, check, *, marker=True, recipes=True, distfiles=True, dsc=True):
        self.assertEqual(args[:3], ['docker', 'run', '--rm'])
        self.assertTrue(check)
        self.assertIsInstance(input, bytes)
        self.assertIn('source-fetch-complete.txt', input.decode())
        target = self.out / 'os-sources/db'
        self.assertIn('type=bind,source=' + str(target.resolve()) + ',target=/output', args)
        if '-i' not in args:
            # Docker can exit zero on an empty stdin, which caused the original
            # false success. Model exactly that behavior, without output files.
            return subprocess.CompletedProcess(args, 0)
        lines = (target / 'packages.txt').read_text().splitlines()
        if recipes:
            for line in lines:
                destination = target / 'recipes' / line.split('|')[0] / 'APKBUILD'
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_text('# synthetic recipe fixture\n')
        if distfiles:
            (target / 'distfiles').mkdir(exist_ok=True)
            (target / 'distfiles/source.tar.gz').write_bytes(b'fixture-only')
        if dsc:
            (target / 'sources').mkdir(exist_ok=True)
            for n, line in enumerate(lines):
                (target / 'sources' / f'fixture-{n}.dsc').write_text('fixture-only\n')
        if marker:
            (target / 'source-fetch-complete.txt').write_text('sources-verified\n')
        return subprocess.CompletedProcess(args, 0)

    def test_actual_fileless_virtual_has_all_providers_and_real_origins_remain(self):
        result = self.collect()
        self.assertEqual(result['status'], 'NOT RUN')
        self.assertEqual(result['packages'], 42)
        inventory = json.loads((self.out / 'os-sources/db/virtual-metapackages.json').read_text())
        self.assertEqual(len(inventory), 1)
        self.assertEqual(inventory[0]['name'], '.postgresql-rundeps')
        self.assertEqual(len(inventory[0]['dependencies']), 24)
        self.assertTrue(all(names for names in inventory[0]['providers'].values()))
        self.assertIn('musl|', (self.out / 'os-sources/db/packages.txt').read_text())

    def test_apk_parser_keeps_zero_size_and_payload_presence_distinct(self):
        data = 'P:.fixture\nV:1\nI:0\nD:musl\np:virtual=1\nF:etc\nR:file\n'
        package = collector.parse_apk(data)[0]
        self.assertEqual(package['installedBytes'], 0)
        self.assertEqual(package['fileEntries'], 2)
        self.assertEqual(package['dependencies'], ['musl'])
        self.assertEqual(package['provides'], ['virtual=1'])

    def test_real_package_missing_origin_or_commit_fails(self):
        for field in ['origin', 'commit']:
            report = copy.deepcopy(self.report)
            package = next(p for p in report['osPackages'] if not p['name'].startswith('.'))
            package[field] = ''
            with self.subTest(field=field), self.assertRaisesRegex(RuntimeError, 'lacks source'):
                self.collect(report)

    def test_virtual_guard_rejects_payload_missing_size_unresolved_or_self_dependency(self):
        mutations = [
            {'installedBytes': 1}, {'installedBytes': -1}, {'fileEntries': 1},
            {'dependencies': []}, {'dependencies': ['not-installed']},
            {'dependencies': ['.postgresql-rundeps']}, {'name': 'ordinary-fileless'},
            {'origin': 'unknown'},
        ]
        for mutation in mutations:
            report = copy.deepcopy(self.report)
            package = next(p for p in report['osPackages'] if p['name'] == '.postgresql-rundeps')
            package.update(mutation)
            with self.subTest(mutation=mutation), self.assertRaisesRegex(RuntimeError, 'lacks source'):
                self.collect(report)

    def test_success_requires_interactive_stdin_and_acquired_files(self):
        def execute(args, **kwargs):
            self.assertIn('-i', args, 'Docker source script must receive stdin')
            return self.helper(args, **kwargs)
        with patch.object(collector.subprocess, 'run', side_effect=execute) as executor:
            result = self.collect(download=True)
        self.assertEqual(executor.call_count, 1)
        self.assertEqual(result['status'], 'PASS')

    def test_lost_interactive_flag_zero_exit_cannot_pass(self):
        def execute(args, **kwargs):
            return self.helper([arg for arg in args if arg != '-i'], **kwargs)
        with patch.object(collector.subprocess, 'run', side_effect=execute):
            with self.assertRaisesRegex(RuntimeError, 'missing verified marker'):
                self.collect(download=True)

    def test_missing_completion_marker_cannot_pass(self):
        with patch.object(collector.subprocess, 'run', side_effect=lambda args, **kw: self.helper(args, **kw, marker=False)):
            with self.assertRaisesRegex(RuntimeError, 'missing verified marker'):
                self.collect(download=True)

    def test_incorrect_completion_marker_cannot_pass(self):
        def execute(args, **kwargs):
            result = self.helper(args, **kwargs)
            (self.out / 'os-sources/db/source-fetch-complete.txt').write_text('started-only\n')
            return result
        with patch.object(collector.subprocess, 'run', side_effect=execute):
            with self.assertRaisesRegex(RuntimeError, 'missing verified marker'):
                self.collect(download=True)

    def test_missing_recipe_cannot_pass_even_with_completion_marker(self):
        with patch.object(collector.subprocess, 'run', side_effect=lambda args, **kw: self.helper(args, **kw, recipes=False)):
            with self.assertRaisesRegex(RuntimeError, 'Missing acquired APK source recipe'):
                self.collect(download=True)

    def test_empty_distfiles_cannot_pass_even_with_recipes_and_marker(self):
        with patch.object(collector.subprocess, 'run', side_effect=lambda args, **kw: self.helper(args, **kw, distfiles=False)):
            with self.assertRaisesRegex(RuntimeError, 'No acquired source distfiles'):
                self.collect(download=True)

    def test_debian_requires_source_descriptors(self):
        report = {'distribution': 'debian', 'osPackages': [{'origin': 'example', 'sourceVersion': '1.2'}]}
        with patch.object(collector.subprocess, 'run', side_effect=lambda args, **kw: self.helper(args, **kw, dsc=False)):
            with self.assertRaisesRegex(RuntimeError, 'Missing acquired Debian source descriptors'):
                self.collect(report, download=True)

    def notice_fixture(self, static_text=None, indexed=True):
        notice=(COLLECTOR.parents[2]/'licenses/Npgsql-LICENSE.txt').read_text(encoding='utf-8-sig')
        package='Npgsql/10.0.3'
        actual=self.out/'nuget'/collector.safe_name('Npgsql-10.0.3')
        actual.mkdir(parents=True)
        (actual/'upstream-LICENSE.txt').write_text(notice,encoding='utf-8')
        (actual/'source.json').write_text(json.dumps({'notices':['upstream-LICENSE.txt']}))
        static=self.out/'static-api-image-licenses'
        static.mkdir()
        text=notice if static_text is None else static_text
        (static/'Npgsql-LICENSE.txt').write_text(text,encoding='utf-8')
        index={'packages':{}}
        if indexed:
            index['packages'][package]={'file':'Npgsql-LICENSE.txt','sha256':hashlib.sha256(text.encode().replace(b'\r\n',b'\n')).hexdigest()}
        (static/'nuget-license-index.json').write_text(json.dumps(index))
        return {'nuget':[package]},static

    def test_static_notice_requires_full_text_not_spdx_wrapper(self):
        report,static=self.notice_fixture('SPDX-License-Identifier: PostgreSQL\n')
        with self.assertRaisesRegex(RuntimeError,'copyright/license missing'):
            collector.validate_static_nuget_notices(report,self.out,static)

    def test_static_notice_missing_npgsql_copyright_fails(self):
        notice=(COLLECTOR.parents[2]/'licenses/Npgsql-LICENSE.txt').read_text(encoding='utf-8-sig')
        stripped='\n'.join(line for line in notice.splitlines() if 'Copyright' not in line)
        report,static=self.notice_fixture(stripped)
        with self.assertRaisesRegex(RuntimeError,'copyright/license missing'):
            collector.validate_static_nuget_notices(report,self.out,static)

    def test_static_notice_full_actual_text_and_exact_index_pass(self):
        report,static=self.notice_fixture()
        result=collector.validate_static_nuget_notices(report,self.out,static)
        self.assertEqual(result['status'],'PASS')
        self.assertEqual(result['checks'][0]['package'],'Npgsql/10.0.3')

    def test_static_notice_tampering_fails_even_with_another_full_copy(self):
        report,static=self.notice_fixture()
        path=static/'Npgsql-LICENSE.txt'
        (static/'aggregate-LICENSE.txt').write_bytes(path.read_bytes())
        path.write_text('tampered fixture\n')
        with self.assertRaisesRegex(RuntimeError,'provenance/hash mismatch'):
            collector.validate_static_nuget_notices(report,self.out,static)

    def test_exact_npgsql_version_without_reviewed_index_fails(self):
        report,static=self.notice_fixture(indexed=False)
        with self.assertRaisesRegex(RuntimeError,'Exact Npgsql version requires reviewed notice provenance'):
            collector.validate_static_nuget_notices(report,self.out,static)


if __name__ == '__main__':
    unittest.main(verbosity=2)
