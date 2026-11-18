# Claude Code — START HERE: find the real ShortMe source on GitHub FIRST

Copy/paste this entire instruction into a Claude Code session that has file/terminal/GitHub access. This step **precedes** the other prompts in this pack.

```text
You are working on our existing proprietary ShortMe Windows app. The owner believes the complete source code is on their GitHub account, possibly private. Your first deliverable is to **find and verify the correct source repository**, not to build a guessed UI or a disconnected macOS demo. All relevant macOS-engine, model, hardware and UI-parity requirements are in the accompanying ShortMe macOS kit.

PHASE G0 — SAFE GITHUB CONNECT AND DISCOVERY (MANDATORY)
1. Determine whether this session is local CLI, Claude Code Desktop local, or Claude Code web/cloud, and whether the current directory is an actual git worktree: `pwd`; `git rev-parse --show-toplevel`; `git remote -v`; `git status --short --branch`. If a trustworthy remote exists, record it; NEVER assume the current directory is the right product until source is verified.
2. Check installed GitHub CLI with `gh --version` then `gh auth status` (do not print credentials or tokens). If unavailable, use already configured `git` access / approved environment. If interactive authorization is needed on the user's Mac, **ask the user to authorize with `gh auth login --web` themselves**. For Claude Code web/cloud, follow the Claude GitHub App connection or `/web-setup` instructions rather than claiming local gh auth automatically grants the cloud session repo access.
3. In the authorized account, discover plausible repos with `gh repo list --limit 200 --json nameWithOwner,name,isPrivate,updatedAt,url,description` and the equivalent commands for any identified team organization. Prefer an exact previously configured git remote or exact user-confirmed `owner/repo` over name similarity. Check read access using `gh repo view OWNER/REPO --json nameWithOwner,url,isPrivate,defaultBranchRef`. If the list is insufficient, paginate/review organization access; do not claim not found based on the first 200.
4. For each plausible candidate, inspect repository tree/readme/manifests and source to verify it contains the REAL Windows ShortMe UI and/or app engines: frontend (routes/components/assets/styles), application shell, timeline/video editor, engine adapters/jobs, project files, export/render code and build scripts. ShortMe-related documentation or an engine-only repo is not proof that it is the desktop application. Check possibility of a monorepo or multiple linked repos, submodules, Git LFS or generated sources.
5. If there are multiple plausible repos, missing authorization, or no verified Windows app source, STOP before implementing or guessing, report exact blocker and ask for **canonical `owner/repo` or access**. Never clone random public projects called ShortMe as the user's source.
6. Once positively verified, record `owner/repo`, URL, visibility (not secrets), default branch, current git SHA, manifests, frontend framework, identified root path and evidence of original UI in `docs/implementation/shortme-mac/docs/SHORTME_SOURCE_AUDIT.md` (or a consistent path inside the verified repo). Keep this audit in the feature branch.

PHASE G1 — SAFE WORKTREE
7. If no cloned source exists, clone the verified repo with `gh repo clone OWNER/REPO` into a user-approved workspace. Keep `main` / existing Windows release branch unchanged. Create a dedicated `feat/shortme-macos-native` branch or isolated git worktree from the appropriate baseline; don't overwrite uncommitted files. Do not force checkout, hard reset, push, open PR, modify repository permissions, or install GitHub Apps without explicit authorization.
8. If the code needs private Git submodules or LFS assets, verify authorization and follow repository policies; do not commit binary models, secrets, datasets or licensed fonts without redistribution rights.
9. Only now place the accompanying **kit contents** at `docs/implementation/shortme-mac/` within the real repo and read `01_CLAUDE_CODE_MASTER_PROMPT.md` together with docs/01–17 and `03_CLAUDE_CODE_UI_PARITY_ADDENDUM.md`.

PHASE G2 — SOURCE-BASED MAC PORT
10. Prefer one shared Windows/macOS frontend, exact design tokens, components, assets and UI flows. Do not invent a new SwiftUI UI. Only allow documented macOS window controls/menus/dialogs and Cmd shortcuts to vary. Capture/compare genuine Windows and macOS screens at identical fixture and content sizes; mark parity BLOCKED until there is real Windows baseline evidence.
11. Add the Apple Silicon native `macNative` engine behind existing stable UI/job contracts. Preserve existing Windows engines, full video scan, independent transcript/audio/visual analysis, humor/scene ranking, cuts, captions, editing, proper rendering and post-render verification. Detect chip/physical RAM/live pressure and choose conservative 8/16/24–32/64+ profiles; 16 GiB gets full functionality with sequential heavy models and resumable checkpoints, not silently skipped lanes.
12. Execute tests available on the current OS, then Mac-native model/runtime + UI/export tests on an authorized Apple Silicon machine. Label anything untested or blocked. No declaration of final 1:1 Mac app or superior model results without measured evidence.
13. Before touching original Windows builds, report what was verified (repo/SHA/UI stack), what changed on the feature branch, tests with precise status, and any blockers. No remote push without user approval.

The correct source repository is NOT embedded in the attached ZIP. Repository discovery is a hard prerequisite. Respect every existing repo instruction/AGENTS.md/CLAUDE.md and do not expose secrets.
```

If GitHub authentication is missing, human action is required. Avoid asking the user to paste their GitHub token into the conversation.
