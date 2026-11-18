import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "policy"))
from hardware_policy import plan, UnsupportedMachine, GIB


def hw(ram, *, pressure="normal", thermal="nominal", low_power=False, metal=True, silicon=True):
    return dict(apple_silicon=silicon, metal_supported=metal,
                physical_memory_bytes=ram * GIB,
                metal_recommended_working_set_bytes=int(ram * GIB * .75),
                metal_current_allocated_bytes=0,
                low_power_mode=low_power, thermal_state=thermal,
                memory_pressure=pressure)

class PolicyTests(unittest.TestCase):
    def test_8gb_small(self):
        p = plan(hw(8))
        self.assertEqual(p.profile, "fast")
        self.assertEqual(p.frame_batch, 1)
        self.assertEqual(p.max_simultaneous_heavy_models, 1)

    def test_16gb_standard_default(self):
        p = plan(hw(16))
        self.assertEqual(p.hardware_tier, "standard16")
        self.assertEqual(p.profile, "balanced")
        self.assertEqual(p.max_simultaneous_heavy_models, 1)
        self.assertGreater(p.ai_worker_budget_bytes, 0)
        self.assertLess(p.ai_worker_budget_bytes, 7 * GIB)

    def test_32gb_expanded(self):
        p = plan(hw(32))
        self.assertEqual(p.hardware_tier, "expanded")
        self.assertEqual(p.profile, "balanced")
        self.assertEqual(p.max_simultaneous_heavy_models, 1)

    def test_64gb_large(self):
        p = plan(hw(64))
        self.assertEqual(p.profile, "deep")
        self.assertEqual(p.max_simultaneous_heavy_models, 1)

    def test_64gb_validated_can_parallelize(self):
        d = hw(64)
        d["high_memory_concurrency_validated"] = True
        p = plan(d)
        self.assertEqual(p.max_simultaneous_heavy_models, 2)

    def test_critical_pressure_pauses_not_skips(self):
        p = plan(hw(16, pressure="critical"))
        self.assertEqual(p.memory_pressure_action, "pause_after_checkpoint_unload_models")
        self.assertEqual(p.profile, "fast")

    def test_serious_thermal_degrades(self):
        p = plan(hw(64, thermal="serious"))
        self.assertEqual(p.frame_batch, 1)
        self.assertEqual(p.profile, "balanced")

    def test_deep_request_on_16_is_not_assumed_safe(self):
        p = plan(hw(16), "deep")
        self.assertEqual(p.profile, "balanced")

    def test_metal_limit_bound(self):
        h = hw(32)
        h["metal_recommended_working_set_bytes"] = 2 * GIB
        p = plan(h)
        self.assertLessEqual(p.ai_worker_budget_bytes, int(2 * GIB * .7))

    def test_unsupported_intel_or_metal(self):
        with self.assertRaises(UnsupportedMachine): plan(hw(16, silicon=False))
        with self.assertRaises(UnsupportedMachine): plan(hw(16, metal=False))

    def test_bad_memory_pressure(self):
        with self.assertRaises(ValueError): plan(hw(16, pressure="high"))

if __name__ == "__main__": unittest.main()
