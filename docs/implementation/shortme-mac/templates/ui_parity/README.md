# UI parity evidence templates

This folder contains a **screen inventory template** and a **standalone screenshot difference helper**, not actual Windows or Mac app screenshots. Those cannot be generated without the user's real ShortMe UI source/app and a running OS.

Capture a pinned, stable fixture state at the same logical size and pixel scaling on each OS, ideally in the application **content area** excluding native window controls. For each screen capture and compare via:

```bash
python tools/compare_ui_screenshots.py --baseline /path/to/windows.png --actual /path/to/mac.png --out /path/to/ui-parity/diffs/example
```

Requires Pillow (`python -m pip install Pillow` in a disposable dev environment). The helper reports pixel differences, writes `-diff.png`, `-overlay.png` and `-metrics.json`, and **does not decide pass/fail** because font rasterization differs across OSes. A reviewer must audit the diffs for unauthorized layout/icon/component differences. Avoid cropping/masking the actual ShortMe UI itself.

If the sizes differ, the script explicitly fails. Correct DPI/viewport and recapture rather than rescaling images to force a comparison. Tests should also verify keyboard/menu/import/timeline/export behavior, not just static screenshots.
