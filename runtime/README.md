# Runtime Release Process

`manim-cli` ships a small npm package and a separate managed runtime bootstrap bundle per platform. The npm package owns installation and orchestration; GitHub Release assets are the canonical bootstrap-bundle host.

## Supported Targets

- `darwin-arm64`
- `darwin-x64`
- `linux-x64`
- `linux-arm64`
- `win32-x64`

`linux-arm64` still requires a self-hosted ARM64 runner unless your GitHub plan provides one.

## Bundle Format

Published runtime assets are bootstrap bundles, not pre-relocated Python environments.

Each bundle archive contains:

- `runtime.json`
- `bootstrap.json`
- `requirements/`
- `tools/micromamba` or `tools/micromamba.exe` when available at release time

At install time, `manim-cli setup` extracts the bundle, creates the runtime at its final install prefix, installs the pinned runtime packages there, writes `runtime.json`, and then runs smoke validation. This avoids the macOS relocation failures that occur with packed Cairo/Pango environments.

`runtime.json` includes:

- `version`
- `platform`
- final binary paths for `python`, `pip`, `manim`, `ffmpeg`, and `ffprobe`
- feature flags for `cairo`, `opengl`, optional `latex`, and bundled provider IDs

`bootstrap.json` includes:

- `kind`
- `platform`
- `pythonVersion`
- `manimVersion`
- `condaPackages`
- `pipPackages`
- `requirementsFiles`

## Release Flow

### 1. Validate the runtime recipe on each runner

The workflow still provisions a real runtime root per platform and runs smoke checks there:

- `python --version`
- `manim --version`
- `ffmpeg -version`
- `ffprobe -version`
- sample Cairo render

This is release gating only. That built environment is not what gets published.

### 2. Build the bootstrap bundle

Generate the bundle root:

```bash
node scripts/prepare-runtime-bundle.mjs \
  --bundle-root runtime/bundle/darwin-arm64/manim-runtime \
  --platform darwin-arm64 \
  --version 0.20.1 \
  --manim-version 0.20.1 \
  --python-version 3.11 \
  --micromamba-path "$(command -v micromamba)"
```

Pack it:

```bash
node scripts/pack-runtime.mjs \
  --runtime-root runtime/bundle/darwin-arm64/manim-runtime \
  --platform darwin-arm64 \
  --version 0.20.1 \
  --out-dir runtime/dist
```

### 3. Publish to GitHub Releases

Release tag format:

- `runtime-v${runtime_version}`

Asset URL format:

- `https://github.com/<owner>/<repo>/releases/download/runtime-v${runtime_version}/${archive_name}`

### 4. Generate the client manifest

```bash
node scripts/generate-runtime-manifest.mjs \
  --bundles-dir runtime/dist \
  --github-repo your-org/manim-cli \
  --release-tag runtime-v0.20.1 \
  --version 0.20.1 \
  --minimum-cli-version 0.1.0 \
  --install-strategy bootstrap \
  --out runtime/runtime-manifest.json
```

Validate it:

```bash
node scripts/validate-runtime-assets.mjs runtime/runtime-manifest.json
```

## Acceptance Checklist

Run on a clean machine per platform:

```bash
npm install -g manim-cli
manim-cli setup
manim-cli doctor --json
manim-cli runtime info --json
manim-cli -ql examples/hello.py HelloScene
```

Then test optional flows:

```bash
manim-cli -ql --tts examples/hello.py HelloScene
manim-cli -ql --captions examples/hello.py HelloScene
manim-cli -ql --renderer opengl examples/hello.py HelloScene
```

OpenGL is allowed only when the installed runtime probe reports it as `available`. A bundle may advertise OpenGL support in metadata but still be blocked at runtime if real context creation fails on that machine.

## Operational Notes

- `manim-cli setup` no longer depends on system Python or system `ffmpeg`.
- The bootstrap bundle may fall back to local `micromamba`, `mamba`, or `conda` if the bundle does not include `micromamba`.
- Provider-specific TTS packages are not installed during `setup`; they remain lazy-installed on demand.
- The checked-in `runtime/runtime-manifest.json` should remain empty until real release assets are published.
