"""Test integrity of the portable V4 acceptance package itself.

Not tests for actual Shortme V4: those must be created in the real app repo.
"""
import importlib.util
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('gate',ROOT/'tools'/'v4_gate.py')
gate=importlib.util.module_from_spec(spec); spec.loader.exec_module(gate)

class PackageTests(unittest.TestCase):
    def test_package_manifest_integrity(self):
        manifest=json.loads((ROOT/'PACKAGE_MANIFEST.json').read_text())
        self.assertEqual(manifest['engineId'],'engine4')
        self.assertEqual(manifest['numberOfRequirements'],54)
        self.assertEqual(manifest['requirementsSha256'],hashlib.sha256((ROOT/'requirements/v4_requirements.json').read_bytes()).hexdigest())
        for item in manifest['files']:
            file=ROOT/item['path']
            self.assertTrue(file.is_file(),item['path'])
            raw=file.read_bytes()
            self.assertEqual(len(raw),item['size'],item['path'])
            self.assertEqual(hashlib.sha256(raw).hexdigest(),item['sha256'],item['path'])

    def test_unique_requirement_ids(self):
        spec=json.loads((ROOT/'requirements/v4_requirements.json').read_text())
        ids=[r['id'] for r in spec['requirements']]
        self.assertEqual(len(ids),54)
        self.assertEqual(len(ids),len(set(ids)))
        self.assertEqual(spec['engineId'],'engine4')
        self.assertTrue(all(r['title'] and r['acceptance'] and r['required_proof'] for r in spec['requirements']))

    def test_fail_closed_on_empty_repository(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); (root/'docs').mkdir()
            result=gate.audit(root,root/'docs/ENGINE_V4_EVIDENCE.json','core',root/'docs/ENGINE_V4_RUN_PROOF.json')
            self.assertEqual(result['gate'],'FAIL')
            self.assertEqual(result['passed'],0)
            self.assertTrue(result['failedRequirements'])

    def test_strict_path_with_no_package_as_proof(self):
        with tempfile.TemporaryDirectory() as tmp:
            r=Path(tmp)
            (r/'docs/implementation/shortme-engine-v4/tools').mkdir(parents=True)
            p=r/'docs/implementation/shortme-engine-v4/tools/fake.py';p.write_text('pass')
            self.assertFalse(gate.contained_file(r,'docs/implementation/shortme-engine-v4/tools/fake.py'))
            good=r/'src/v4.py';good.parent.mkdir();good.write_text('pass')
            self.assertTrue(gate.contained_file(r,'src/v4.py'))

    def test_proof_cannot_pass_without_media(self):
        with tempfile.TemporaryDirectory() as tmp:
            errs=gate.verify_media_proof(Path(tmp),{'engineId':'engine4','runKind':'full-source-analysis'})
            self.assertTrue(len(errs)>5)

if __name__=='__main__': unittest.main()
