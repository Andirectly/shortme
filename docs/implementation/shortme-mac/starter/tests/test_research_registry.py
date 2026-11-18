from pathlib import Path
import json
import unittest

ROOT = Path(__file__).resolve().parents[2]

class ResearchRegistryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads((ROOT / "research" / "model_candidates.json").read_text(encoding="utf-8"))

    def test_unique_ids(self):
        ids = [m["id"] for m in self.data["models"]]
        self.assertEqual(len(ids), len(set(ids)))

    def test_no_fabricated_hardware_proof(self):
        self.assertTrue(all(m["passed16GiB"] is False and m["downloaded"] is False for m in self.data["models"]))
        self.assertEqual(self.data["testStatus"], "all-unverified-on-user-hardware")

    def test_strict_v4_vision_checkpoint_retained(self):
        self.assertIn(self.data["v4StrictVisualModelId"], [m["id"] for m in self.data["models"]])

    def test_noncommercial_checkpoint_excluded(self):
        bad = [m for m in self.data["models"] if m["licenseEvidence"] == "RESEARCH-ONLY-WEIGHTS"]
        self.assertTrue(bad)
        self.assertTrue(all(m["status"] == "excluded-commercial" for m in bad))

    def test_new_ultra_and_redux_are_registered(self):
        entries = {m["id"]: m for m in self.data["models"]}
        self.assertIn("parakeet-ultra", entries)
        self.assertIn("parakeet-redux", entries)
        self.assertEqual(entries["parakeet-ultra"]["status"], "default-prototype")

    def test_official_gemma4_license_corrected(self):
        entries = {m["id"]: m for m in self.data["models"]}
        for mid in ("gemma4-e4b", "gemma4-e2b"):
            self.assertIn("Apache-2.0", entries[mid]["licenseEvidence"])
            self.assertIn("huggingface.co/google/gemma-4", entries[mid]["source"])

    def test_each_source_traceable(self):
        self.assertTrue(all(m["source"].startswith("https://") and m["role"] for m in self.data["models"]))

if __name__ == "__main__":
    unittest.main()
