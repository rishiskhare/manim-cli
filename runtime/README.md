# Runtime Release Process

`manim-cli` ships a small npm package and a separate managed runtime per supported platform. The npm package owns the installer and orchestration; GitHub Release assets are the canonical runtime host.

## Supported Runtime Targets

- `darwin-arm64`
- `darwin-x64`
- `linux-x64`
- `linux-arm64`
- `win32-x64`

`linux-arm64` requires a self-hosted ARM64 Linux runner unless your GitHub plan provides a hosted ARM64 Linux runner.

## Runtime Archive Requirements

Each published runtime archive must unpack to a single root directory containing:

- `runtime.json`
- a runtime-local `bin/` directory on macOS/Linux or `Scripts/` on Windows
- the pinned Python runtime
- the pinned Manim Community installation
- bundled `ffmpeg` and `ffprobe` for `manim-cli` composition
- any shared libraries needed by the packaged runtime

`runtime.json` must include:

- `version`
- `platform`
- relative paths for `python`, `pip`, `manim`, `ffmpeg`, and `ffprobe`
- `features.cairo`
- `features.opengl`
- optional `features.latex`
- optional `features.providers`

## Provisioning Inputs

The runtime build scripts expect:

- `runtime_version`: the runtime bundle version published to GitHub Releases
- `manim_version`: the exact pinned Manim Community version bundled into the runtime
- `python_version`: the exact Python version bundled into the runtime
- `minimum_cli_version`: the lowest compatible npm package version
- `providers`: optional comma-separated provider IDs to record in `runtime.json`

### Unix provisioning

```bash
bash scripts/provision-runtime-unix.sh \
  --runtime-root runtime/build/darwin-arm64/manim-runtime \
  --platform darwin-arm64 \
  --runtime-version 0.20.1 \
  --manim-version 0.20.1 \
  --python-version 3.11
```

### Windows provisioning

```powershell
./scripts/provision-runtime-windows.ps1 `
  -RuntimeRoot runtime/build/win32-x64/manim-runtime `
  -Platform win32-x64 `
  -RuntimeVersion 0.20.1 `
  -ManimVersion 0.20.1 `
  -PythonVersion 3.11
```

These scripts:

- create an isolated micromamba environment at the runtime root
- install pinned Python, Manim Community, `pyav`, `ffmpeg`, and `ffprobe`
- install the runtime-bridge Python requirements
- validate `python`, `manim`, `ffmpeg`, and `ffprobe`
- run a sample Cairo render
- detect OpenGL import support
- write `runtime.json`

## Packaging and Publishing

### 1. Pack each runtime archive

```bash
npm run runtime:pack -- \
  --runtime-root runtime/build/darwin-arm64/manim-runtime \
  --platform darwin-arm64 \
  --version 0.20.1 \
  --out-dir runtime/dist
```

Archive naming must match:

- `${platform}-${version}.tar.gz` for macOS/Linux
- `${platform}-${version}.zip` for Windows

### 2. Publish runtime archives to GitHub Releases

GitHub Release tag format:

- `runtime-v${runtime_version}`

Asset URL mapping used by the client manifest:

- `https://github.com/<owner>/<repo>/releases/download/runtime-v${runtime_version}/${archive_name}`

### 3. Generate the client manifest

```bash
npm run runtime:manifest -- \
  --bundles-dir runtime/dist \
  --github-repo your-org/manim-cli \
  --release-tag runtime-v0.20.1 \
  --version 0.20.1 \
  --minimum-cli-version 0.1.0 \
  --out runtime/runtime-manifest.json
```

### 4. Validate the generated manifest

```bash
npm run runtime:validate -- runtime/runtime-manifest.json
```

The manifest validator rejects:

- empty manifests
- duplicate platform entries
- unsupported platform names
- invalid checksums
- non-absolute URLs
- non-GitHub-Release URLs for published assets

## Rollback Procedure

If a published runtime bundle is bad:

1. Publish a corrected runtime bundle under a new runtime version.
2. Generate a new `runtime-manifest.json` pointing to the corrected assets.
3. Release a new npm package that includes the new manifest.
4. Existing clients can use `manim-cli runtime upgrade` to switch; failed upgrades keep the previous validated runtime in install state.

Do not overwrite a broken runtime asset in place. Always publish a new runtime version.

## Clean-Machine Acceptance Checklist

Run on each supported platform:

```bash
npm install -g manim-cli
manim-cli setup
manim-cli doctor --json
manim-cli runtime info --json
manim-cli -ql examples/hello.py HelloScene
manim-cli -ql --tts examples/hello.py HelloScene
manim-cli -ql --captions examples/hello.py HelloScene
```

Where the runtime metadata enables OpenGL:

```bash
manim-cli -ql --renderer opengl examples/hello.py HelloScene
```

## Notes

- Manim Community no longer requires external `ffmpeg` for rendering, but `manim-cli` still bundles `ffmpeg` and `ffprobe` for composition, captions, and muxing.
- The checked-in `runtime/runtime-manifest.json` is release-generated. It should remain empty until real archives are published and validated.
