# ShortMe macOS V4 — GitHub FIRST | Start here

The user says that the **full existing Windows ShortMe app should be on GitHub**. No URL/owner or authorization token was provided. **Do not guess the repository, pretend it has been accessed, or substitute a public repo called ShortMe.**

## Quick start for Claude Code

**Place `04_CLAUDE_CODE_GITHUB_CONNECT_PROMPT.md` into Claude Code first** (or paste its full text). Claude is required to locate and verify the actual private/public user repository before touching the app. If necessary, the user completes GitHub authentication interactively using `gh auth login` or, for Claude Code cloud sessions, the GitHub connection flow / `/web-setup` (documentation: https://code.claude.com/docs/en/claude-code-on-the-web).

Once verified:
1. Check out the real repository on a **separate macOS development branch or worktree**, keeping the Windows app working.
2. Copy the **CONTENTS** of this kit directory into `<real-source-repo>/docs/implementation/shortme-mac/`. Do not overwrite existing app files or repository configuration. If a file with the same name already exists, inspect/diff before editing.
3. Run `01_CLAUDE_CODE_MASTER_PROMPT.md` **in the real source repository**, then obey the P0 UI-parity and hardware-auto constraints.
4. Build and validate on a real 16-GiB Apple Silicon Mac; do not claim completed Mac inference or 1:1 visual parity from this docs-only archive.

## Safety and truthfulness

- Do not paste personal access tokens, passwords, or repository secrets into chat/prompt files.
- Do not require GitHub login if existing authorized `git`/`gh` access works; inspect the remote first.
- Do not select a similarly named public repository without positively identifying its original ShortMe UI, editors and Windows engine source.
- If access fails or multiple repositories match, **stop the source audit and ask for the canonical `owner/repo` or permission**; do not invent source code or continue with a placeholder UI.
- No `git push`, remote branch changes, secret changes, or pull requests without clear user permission. Build locally on the feature branch first.

Included: Mac-native 16-GiB-first engine planning, model research, reviewed Windows V4 reference and tests, 1:1 UI parity contract, and this GitHub-first onboarding. **Not a finished Mac application.**
