# Offline reference policy

This policy is **designed for code review and tests**, not a production system monitor. It reads JSON emitted by the Swift probe or synthetic test fixtures and recommends an initial profile and approximate per-worker planning limits.

Production still needs: live memory pressure notifications; actual process RSS and GPU/MLX active+cache; real model peak/latency tests on M-series chips; staged unload and strict checkpoint/restore. A `balanced` profile does not mean specific models fit. A `deep` request may be downgraded on 16 GiB.

Use from package root: `python3 starter/policy/hardware_policy.py starter/fixtures/mac16.json`.
