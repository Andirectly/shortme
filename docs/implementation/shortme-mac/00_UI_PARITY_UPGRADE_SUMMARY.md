# V3 update: exact ShortMe look on macOS

## Why this exists
The Mac engine research was strong, but the earlier package only said to reuse the existing UI where possible. The user clarified an absolute requirement: **Mac ShortMe must look 1:1 like existing Windows ShortMe**.

## Changes in this version
- `03_CLAUDE_CODE_UI_PARITY_ADDENDUM.md`: copy/paste P0 directive for Claude Code.
- `docs/15_UI_PIXEL_PARITY_AND_DESIGN_FREEZE.md`: source-first shared-UI strategy, design freeze, baseline capture and visual acceptance.
- `docs/16_MAC_INTEGRATION_EDGE_CASES.md`: Mac permissions, shortcuts, VFR/color/caption export, code signing and memory UX.
- `templates/ui_parity/screen_inventory.json`: 18 core screen/state scenarios to adapt to the real UI.
- `tools/compare_ui_screenshots.py`: screenshot diff/overlay with diagnostic pixel metrics, **not** an automatic visual-pass claim.
- Updated `01_CLAUDE_CODE_MASTER_PROMPT.md` and `00_START_HERE.md` to make this mandatory, and fixed copied folder path instructions for the actual ZIP layout.

## What was not available
The supplied V4 ZIPs contain functional documentation, prototype tests and examples. They do **not** include the real Windows app's UI source, logo/font assets or screenshots. **A 1:1 visual claim cannot be proven until Claude Code opens the actual ShortMe app repository and captures reference Windows screens.**

## Recommended use
1. Unzip this V3 kit into the existing ShortMe desktop repo under `docs/implementation/shortme-mac/`, keeping existing app source untouched.
2. Run `01_CLAUDE_CODE_MASTER_PROMPT.md` from the repo root.
3. The UI-parity mandate is also included in that master prompt. If Claude was already working from the earlier V2 package, paste `03_CLAUDE_CODE_UI_PARITY_ADDENDUM.md` into the existing Claude Code session instead.
