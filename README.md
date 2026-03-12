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
