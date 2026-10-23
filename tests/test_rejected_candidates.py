import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('rejected', Path(__file__).resolve().parents[1] / 'scripts/release/cleanup-rejected-images.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RejectedImageChecks(unittest.TestCase):
    def test_only_exact_rejected_digest_and_single_source_tag_are_eligible(self):
        record = {'digest': 'sha256:' + '1' * 64, 'sourceSha': 'a' * 40}
        version = {'name': record['digest'], 'metadata': {'container': {'tags': ['sha-' + record['sourceSha']]}}}
        self.assertTrue(module.eligible(record, version, 'sha256:' + '2' * 64))
        self.assertFalse(module.eligible(record, version, record['digest']))
        for tags in [[], ['0.1.0'], ['sha-' + 'b' * 40], ['sha-' + record['sourceSha'], '0.1.0']]:
            with self.subTest(tags=tags):
                self.assertFalse(module.eligible(record, {'name': record['digest'], 'metadata': {'container': {'tags': tags}}}, 'other'))
        self.assertFalse(module.eligible(record, {'name': 'another', 'metadata': version['metadata']}, 'other'))


if __name__ == '__main__':
    unittest.main()
