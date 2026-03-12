# manim-cli

`manim-cli` is an npm-distributed wrapper for Manim Community Edition with:

- Manim-compatible render commands
- Agent-oriented pipeline commands for Codex/Claude Code
- Local-first multi-provider TTS with Kokoro as the default provider
- OpenAI cloud fallback and managed voice/profile configuration

## Status

This repository contains:

- the npm CLI
- agent workflow and proposal gating
- managed runtime bundle installation
- local-first TTS orchestration
- runtime packaging scripts and fixture tests

## Managed Runtime

`manim-cli` is designed for a zero-manual-install setup flow on supported platforms:

1. `npm install -g manim-cli`
2. `manim-cli setup`
3. `manim-cli` downloads and verifies a platform bootstrap bundle, then creates the managed runtime locally at its final install path

Supported runtime targets:

- `darwin-arm64`
- `darwin-x64`
- `linux-x64`
- `linux-arm64`
- `win32-x64`

Important detail:

- Manim Community no longer requires an external `ffmpeg` binary for rendering itself.
- `manim-cli` still bundles `ffmpeg` and `ffprobe` because the CLI uses them for captions, muxing, and final composition.

Runtime bootstrap bundles are published as GitHub Release assets and referenced by the release-generated [runtime/runtime-manifest.json](/Users/rishikhare/Desktop/manim-cli/runtime/runtime-manifest.json). That file is intentionally empty in the repo until real platform assets are built and published. See [runtime/README.md](/Users/rishikhare/Desktop/manim-cli/runtime/README.md) for the bootstrap-bundle format, provisioning commands, release asset naming, rollback policy, and clean-machine acceptance checklist.

## GitHub automation

This repo ships with:

- [CI](/Users/rishikhare/Desktop/manim-cli/.github/workflows/ci.yml) for `npm ci`, `npm run build`, and `npm test`
- [Runtime Release](/Users/rishikhare/Desktop/manim-cli/.github/workflows/runtime-release.yml) for publishing managed runtime bundles
- [Claude Code Review](/Users/rishikhare/Desktop/manim-cli/.github/workflows/claude-code-review.yml) for automatic PR review
- [Claude Mentions](/Users/rishikhare/Desktop/manim-cli/.github/workflows/claude-mentions.yml) for handling `@claude` comments on PRs and issues
- [Claude Failure Review](/Users/rishikhare/Desktop/manim-cli/.github/workflows/claude-failure-review.yml) for automatically tagging `@claude` on failed CI or runtime-release runs

Anthropic’s official GitHub Actions integration uses `anthropics/claude-code-action@v1`, supports automatic PR review on `pull_request`, and responds to `@claude` mentions in PR or issue comments. It also recommends a repository-level `CLAUDE.md` to guide review behavior: [Claude Code GitHub Actions](https://code.claude.com/docs/en/github-actions).

Setup required before these workflows will work:

1. Install the Claude GitHub app on this repository: [github.com/apps/claude](https://github.com/apps/claude)
2. Add `ANTHROPIC_API_KEY` to GitHub Actions secrets
3. Re-run the workflow or tag `@claude` in a PR comment
