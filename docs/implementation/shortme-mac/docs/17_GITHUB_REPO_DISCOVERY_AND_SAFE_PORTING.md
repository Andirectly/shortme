# 17 — GitHub original-source discovery and safe macOS implementation

## Hard prerequisite: verify owner/repo

The user's new requirement is source-first cloning/reuse through authorized GitHub access. The supplied ZIP **still does not include** the real desktop frontend or complete Windows source, and no canonical repository path/URL was provided. Authentication from this chat is not implied. Repositories may be private or be split into monorepo/app/engine repositories.

| Gate | Action | Evidence required | Failure behavior |
|---|---|---|---|
| G0A | Identify local vs remote Claude environment; inspect git remote and auth | `git remote -v`, `gh auth status` without token | Ask for GitHub login/permissions |
| G0B | Discover candidate repos including organizations | URL/owner/repo + visibility + timestamp | No arbitrary public name match |
| G0C | Inspect actual UI and engines | manifest paths, editor/components/styles/assets, Windows shell, engine integration | Stop if only docs/engine specs |
| G0D | Pin source baseline | branch + full commit SHA + clean/dirty status | Stop if wrong project or ambiguous |
| G1 | Feature branch/worktree | `feat/shortme-macos-native`, preserved base | Never reset/overwrite user files |
| G2 | UI parity proof | real Windows captures + Mac captures and diffs per docs/15 | Mark BLOCKED if unavailable |
| G3 | Engine validation | 16-GiB Apple Silicon measurements and real clips | Mark UNTESTED on non-Mac |

## Example initial checks in Claude Code terminal

```bash
pwd
git rev-parse --show-toplevel 2>/dev/null || true
git remote -v 2>/dev/null || true
git status --short --branch 2>/dev/null || true
gh --version
gh auth status
gh repo list --limit 200 --json nameWithOwner,name,isPrivate,updatedAt,url,description
```

If `gh auth status` fails, user may perform `gh auth login --web` locally. Do not automatically capture/share a token. For Claude Code cloud: use GitHub App consent (private repo must be granted) or `/web-setup`, as appropriate and documented. An installed local CLI login is not proof of access in a remote cloud session. See:
- https://cli.github.com/manual/gh_auth_status
- https://cli.github.com/manual/gh_auth_login
- https://cli.github.com/manual/gh_repo_list
- https://code.claude.com/docs/en/claude-code-on-the-web

Then verify a selected `OWNER/REPO` explicitly:

```bash
gh repo view OWNER/REPO --json nameWithOwner,url,isPrivate,defaultBranchRef
# After positive ownership/source verification and workspace approval:
gh repo clone OWNER/REPO
# Inside checked-out repository (ensure worktree clean, base correct):
git switch -c feat/shortme-macos-native
```

`OWNER/REPO` is a placeholder, not a verified repository! If the feature branch already exists, choose the safe existing branch/worktree; never force overwrite. A separate `git worktree` is recommended to preserve existing Windows checkout.

## Reuse frontend, do not rewrite the UI by default

Determine actual framework before choice of porting strategy:
- Electron/React/Tauri/Qt/HTML etc.: prefer sharing existing components and application styles, adapting native filesystem, process, GPU, menus and packaging bridges.
- Windows-only WPF/WinUI: the original frontend cannot simply be compiled for Mac; capture true reference screens, extract a design/component spec and explicitly scope the minimum faithful port. Never promise instant 1:1 pixel proof.
- Multiple repos: capture exact Git remotes and versions; do not silently mix unrelated projects. Consider linked package versions, protobuf/IPC contracts, submodules and assets.

Keep rendering, timeline, caption format, project persistence and export output backward-compatible. Preserve Windows regression tests; API changes must have compatibility shims, not silently breaking renames.

## Security / scope

- Authentication is performed by the user in the supported consent flow; never ask for a password/PAT in chat, log or Markdown.
- Read access is enough for initial inspection. No push, issue creation, PR, remote branch deletion, CI secret/repo permission edits without separate consent.
- Respect existing `.gitignore`, `CLAUDE.md`, licensing, LFS, code signing credentials, proprietary assets and datasets.
- Supply concise repo audit evidence; do not fabricate tested Mac speeds or screenshot visual parity.
