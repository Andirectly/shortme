# 15 — CRITICAL PRODUCT REQUIREMENT: 1:1 Windows ↔ macOS UI parity

**Priority P0. This is a binding requirement; not a suggestion.**

## What 1:1 means

The existing Windows ShortMe app is the sole authoritative design and interaction reference. **Do not invent/rebrand/redesign any user-facing screen.** macOS must show the same product: visual hierarchy, brand, menus inside the app, icons, typography, colors, component shapes, shadows, navigation labels, spacing, content density, loading/progress states, animation timing, empty/error states, timeline/editor, caption styles, drag and drop behavior, 9:16 preview, clip review and export UI. Windows-specific engine features may be disabled or labelled unavailable on Mac; do not hide required shared workflows. `macNative` replaces the execution backend, **not** the frontend/product identity.

The only acceptable deliberate exceptions are native OS chrome and user interaction semantics: macOS red/yellow/green traffic lights, system menu bar, Cmd shortcuts and OS-standard dialogs where required, permission prompts, file paths and signed/notarized packaging. Avoid redundant in-app title bars and overlapped traffic lights. Maintain identical design within the application content area. Do not redesign the layout merely to look “more native Mac”.

The attached reference ZIPs do **not** contain the ShortMe desktop repository, frontend, fonts, logo assets or captured Windows screenshots. Accordingly 1:1 cannot yet be certified. Claude must inspect the actual repository and capture real baselines before writing any UI replacements or claiming success.

## Step 0: inspect UI stack before choosing a Mac shell

- Identify `package.json`/`Cargo.toml`/`.csproj`/`*.sln`/Swift and build scripts; React/Vue/Svelte/WebView/WPF/WinUI/Qt/Electron/Tauri, exact versions.
- Make a component and route tree of the **real** existing app and link each screen to source files.
- Inventory design tokens (colors, font weights, icons, dimensions, radii, shadows, breakpoints), CSS/SCSS/Tailwind/CSS-in-JS, image/video assets, local fonts and their redistribution licenses.
- Identify native bridges (window management, file dialogs, GPU/FFmpeg/process spawning, IPC, tray/menus, updater, project persistence), and isolate Windows-specific code with adapters/conditional imports.
- **Preference order:** (a) same frontend and same existing desktop shell where macOS is supported; (b) same frontend in compatible Mac host, with audited rendering differences; (c) only if truly impossible, a 1:1 controlled reimplementation of the existing frontend. Never volunteer a whole SwiftUI rewrite if an actual reusable frontend exists.
- If the Windows app is WPF/WinUI or another Windows-only UI stack, don't pretend its UI can run unmodified on macOS. First derive screenshots/components/design tokens from the real source and build a new frontend parity plan with explicit time and risks.

## Required screenshot baseline capture

Use the actual Windows app at a known commit and state. For every screen in `templates/ui_parity/screen_inventory.json`, capture full window and **application-content-only** screenshots at desktop 1440x900 and compact 1280x800 where supported. Capture both supported themes if the app has two; do not invent a theme. Record OS version, DPI/scaling, logical/content pixels, app version/git SHA, font versions and states/data used. Include at least one macOS screenshot for each Windows baseline. Fixed mock fixtures must contain the same captions, timing, media thumbnails, number of candidate clips and metrics (deterministic visual fixtures); avoid testing random generated content.

Baseline folder structure:

```
ui-parity/baselines/windows/<screen-id>__1440x900.png
ui-parity/actual/macos/<screen-id>__1440x900.png
ui-parity/diffs/<screen-id>__1440x900-diff.png
ui-parity/report.json
```

Screenshots must be made from the functioning apps. **Never** use generated sample UI, Figma mockups or docs as a surrogate for genuine Windows app captures. If Windows cannot be run in the current session, mark capture/parity BLOCKED, and implement the UI from real repo code without claiming 1:1 verification.

## Parity protocol and acceptance criteria

1. Compare **content-only image at equal pixel dimensions, render scale and theme**. Mask **only native window controls and clearly documented OS-rendered browser/file-dialog differences**. No broad masks for actual app content.
2. Generate overlay/difference heatmaps using `tools/compare_ui_screenshots.py`; classify each real difference as expected macOS chrome, font rasterization, layout/spacing, color, missing component, wrong icon or functional regression.
3. Test at 100% and a HiDPI/Retina scale; text glyph anti-aliasing differs across operating systems, so no universal numeric percentage proves 1:1. Review overlays manually. **Zero unapproved structural changes** is the release gate; numerical thresholds must be chosen from real captures and documented.
4. Verify all primary screens and states, not just the landing page. No 'close enough', 'inspired by Windows', 'similar style' acceptance.
5. Run Windows UI regression tests and verify Mac UI changes did not alter Windows visuals or behavior. Share platform-neutral frontend components and design tokens rather than copying and maintaining diverging screens.

## Critical UI behavior to preserve

- Long-video import by file picker and drag/drop; macOS security-scoped URLs/bookmarks where applicable, correct filename/Unicode/path handling.
- Full timeline/editor behavior: frame precision, waveforms, trim handles, zoom, timeline drag, preview seek, tracks, audio controls, clip versions, undo/redo, project reopen; the UI must not pretend native engine outputs are present when they are not.
- Project creation, engine selection, per-engine options, source rescan/recheck, cancellation, resumability, progress percentages/stages and edit/export.
- Text/caption preview must closely match **actual exported render** (fonts, line wraps, style/highlight, animation timings, crop safe zones, color management, mixed DPI).
- macOS keyboard input: map Windows Ctrl+Z/C/V/S to Cmd+Z/C/V/S, preserve configured shortcuts, ensure menu bar exposes actual actions, keep Option/Alt semantics explicit; trackpad scroll/pinch where implemented in Windows.
- Window minimize/maximize/fullscreen, red-yellow-green traffic lights, safe draggable title bar, high DPI, external display switching, light/dark system mode policy and accessibility focus/keyboard navigation.
- macOS resource diagnostics live in existing Settings/Performance screen (if present) or a minimally invasive UI-compatible setting, not as a global redesign.
- Handle sleep/wake, disk unplug, files moved after bookmark creation, user cancels permissions, insufficient disk/RAM, model missing; errors should use the app's existing UI components and consistent German/English copy.

## Platform technical notes

- Electron supports `titleBarStyle: 'hiddenInset'` and native macOS traffic lights. See https://www.electronjs.org/docs/latest/tutorial/custom-title-bar . If already Electron, reuse its current frontend and macOS host adaptations.
- Tauri window content on macOS can behave differently due to WebKit. Do **not** migrate Electron → Tauri simply to produce a Mac build unless parity/performance evidence supports it. Tauri official guidance: https://v2.tauri.app/learn/window-customization/ .
- Playwright visual snapshots support screenshot diffs; they warn that OS/font/render differences can affect results: https://playwright.dev/docs/test-snapshots .
- Apple signing/notarization and hardened runtime affect bundled local workers and update delivery: https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution/ .

## Required deliverables before any 'looks identical' claim

1. Actual UI source-file inventory + original framework assessment; Windows screenshot baseline at pinned build version.
2. Mac screenshots for every baseline at matching dimensions/fixtures; visual diffs and documented, reviewed exceptions.
3. UI behavioral parity report + keyboard/menu/drag-drop/timeline/caption/export tests.
4. macOS app bundle running the **shared** frontend + macNative worker, with Windows untouched.
5. Status explicitly `BLOCKED: missing Windows source/baseline` if source/reference UI is absent. Never claim screenshot parity from this documentation-only kit.
