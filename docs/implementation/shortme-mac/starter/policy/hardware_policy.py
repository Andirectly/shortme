"""Offline reference policy for ShortMe Mac. Not a production model loader.

All limits are tentative per-worker planning values, not OS-enforced memory caps.
Run: python3 -m unittest discover -s starter/tests -v
     python3 starter/policy/hardware_policy.py starter/fixtures/mac16.json
"""
from __future__ import annotations
import json
import math
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict

GIB = 1024 ** 3

class UnsupportedMachine(ValueError):
    pass


@dataclass(frozen=True)
class Plan:
    profile: str
    hardware_tier: str
    ai_worker_budget_bytes: int
    mlx_cache_budget_bytes: int
    max_simultaneous_heavy_models: int
    max_simultaneous_transcodes: int
    frame_batch: int
    candidate_investigation_calls: int
    context_seconds_per_call: int
    memory_pressure_action: str
    strict_v4_parity: str
    reasons: list[str]


def plan(hardware: Dict[str, Any], requested_profile: str = "auto") -> Plan:
    """Compute conservative starting config; actual model admission needs measured peak memory.

    Does not test installed models, OS free RAM, actual throughput or all AV features.
    Do not mark source coverage successful based on this policy.
    """
    if requested_profile not in {"auto", "fast", "balanced", "deep"}:
        raise ValueError("requested_profile must be auto, fast, balanced, or deep")
    if not hardware.get("apple_silicon") or not hardware.get("metal_supported"):
        raise UnsupportedMachine("Mac Native engine requires Apple Silicon and working Metal GPU")
    total = int(hardware.get("physical_memory_bytes", 0))
    if total <= 0:
        raise ValueError("physical_memory_bytes is required")
    ram_gib = total / GIB
    if ram_gib <= 12:
        tier, frac, default_profile, batch = "small", .30, "fast", 1
    elif ram_gib <= 20:
        tier, frac, default_profile, batch = "standard16", .36, "balanced", 2
    elif ram_gib <= 40:
        tier, frac, default_profile, batch = "expanded", .43, "balanced", 4
    else:
        tier, frac, default_profile, batch = "large", .49, "deep", 6
    reasons = [f"physical RAM {ram_gib:.1f} GiB -> {tier}"]
    profile = default_profile if requested_profile == "auto" else requested_profile
    if ram_gib < 20 and profile == "deep":
        # Allow the deep algorithm only after independent measured model admission.
        profile = "balanced" if ram_gib > 12 else "fast"
        reasons.append("deep request downgraded pending per-model memory validation")

    # Metal's working-set recommendation is a hint, not free RAM and not a limit.
    recommended = max(0, int(hardware.get("metal_recommended_working_set_bytes") or 0))
    budget = int(total * frac)
    if recommended:
        budget = min(budget, int(recommended * .70))
        reasons.append("bounded against Metal recommended working-set guidance")

    pressure = str(hardware.get("memory_pressure", "unknown")).lower()
    if pressure not in {"unknown", "normal", "warning", "critical"}:
        raise ValueError("memory_pressure must be unknown/normal/warning/critical")
    thermal = str(hardware.get("thermal_state", "unknown")).lower()
    low_power = bool(hardware.get("low_power_mode", False))

    action = "continue"
    if pressure == "critical":
        budget = max(int(.12 * total), int(budget * .45))
        profile, batch, action = "fast", 1, "pause_after_checkpoint_unload_models"
        reasons.append("critical memory pressure: preserve project, pause and unload")
    elif pressure == "warning":
        budget = int(budget * .65)
        batch = 1
        if profile == "deep":
            profile = "balanced"
        action = "finish_current_batch_then_unload_and_reduce"
        reasons.append("memory pressure warning: no new large model")

    if thermal in {"serious", "critical"} or low_power:
        batch = 1
        if profile == "deep":
            profile = "balanced"
        if thermal == "critical":
            action = "pause_after_checkpoint_unload_models"
        reasons.append("thermal or low-power mode: throttle to reduce load")

    # One heavy model at a time is safest until tests establish reliable headroom.
    concurrent_models = (2 if (ram_gib >= 48 and action == "continue"
                               and hardware.get("high_memory_concurrency_validated") is True) else 1)
    transcodes = (2 if (ram_gib >= 48 and action == "continue"
                       and hardware.get("high_memory_concurrency_validated") is True) else 1)
    if profile == "fast":
        investigator_calls, context_seconds = 3, 45
    elif profile == "deep":
        investigator_calls, context_seconds = 6, 90
    else:
        investigator_calls, context_seconds = 5, 60
    budget = max(256 * 1024 * 1024, budget)
    return Plan(
        profile=profile, hardware_tier=tier, ai_worker_budget_bytes=budget,
        mlx_cache_budget_bytes=min(int(budget * .10), 768 * 1024 * 1024),
        max_simultaneous_heavy_models=concurrent_models,
        max_simultaneous_transcodes=transcodes, frame_batch=batch,
        candidate_investigation_calls=investigator_calls,
        context_seconds_per_call=context_seconds,
        memory_pressure_action=action,
        strict_v4_parity="unverified_requires_Qwen3_VL_Embedding_2B_mac_proof",
        reasons=reasons,
    )


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: python3 hardware_policy.py hardware.json [auto|fast|balanced|deep]", file=sys.stderr)
        raise SystemExit(2)
    hardware = json.loads(Path(sys.argv[1]).read_text())
    try:
        result = plan(hardware, sys.argv[2] if len(sys.argv) > 2 else "auto")
    except (ValueError, UnsupportedMachine) as e:
        print(json.dumps({"error": str(e)}, indent=2))
        raise SystemExit(1)
    print(json.dumps(asdict(result), indent=2))

if __name__ == "__main__":
    main()
