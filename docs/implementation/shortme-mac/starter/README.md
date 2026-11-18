# Runnable starter / reference artifacts

- `HardwareProbe/`: self-contained Swift command line hardware probe (macOS only; has **not** been compiled on a Mac in this packaging environment).
- `policy/hardware_policy.py`: cross-platform conservative tier and workload budget reference, **not** the engine or an OS memory limiter.
- `tests/`: pure policy unit tests, run with `python3 -m unittest discover -s starter/tests -v` from package root.
- `fixtures/mac16.json`: illustrative 16 GiB Mac metadata, **not measured from the user's device**.

Expected integration: transform the probe into a long-running Swift service in the existing ShortMe architecture, emit periodic changes to the UI, integrate model-specific measured peak memory admission and durable resume checkpoints, and port the V4 pipeline. None of these starter scripts edit a video.
