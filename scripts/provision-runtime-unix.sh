#!/usr/bin/env bash
set -euo pipefail

ROOT=""
PLATFORM=""
RUNTIME_VERSION=""
MANIM_VERSION="${MANIM_VERSION:-0.20.1}"
PYTHON_VERSION="${PYTHON_VERSION:-3.11}"
PROVIDERS="${PROVIDERS:-kokoro-82m,openai,qwen3-tts-12hz-0.6b-base,qwen3-tts-12hz-1.7b-base,qwen3-tts-12hz-0.6b-customvoice,qwen3-tts-12hz-1.7b-customvoice,chatterbox-turbo}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --runtime-root) ROOT="$2"; shift 2 ;;
    --platform) PLATFORM="$2"; shift 2 ;;
    --runtime-version) RUNTIME_VERSION="$2"; shift 2 ;;
    --manim-version) MANIM_VERSION="$2"; shift 2 ;;
    --python-version) PYTHON_VERSION="$2"; shift 2 ;;
    --providers) PROVIDERS="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$ROOT" || -z "$PLATFORM" || -z "$RUNTIME_VERSION" ]]; then
  echo "Usage: scripts/provision-runtime-unix.sh --runtime-root <dir> --platform <platform> --runtime-version <version> [--manim-version <version>] [--python-version <version>]" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$(dirname "$ROOT")"
rm -rf "$ROOT"

if ! command -v micromamba >/dev/null 2>&1; then
  echo "micromamba is required on the PATH" >&2
  exit 1
fi

case "$PLATFORM" in
  darwin-* )
    micromamba create -y -p "$ROOT" -c conda-forge \
      "python=${PYTHON_VERSION}" \
      "manim=${MANIM_VERSION}" \
      "ffmpeg" \
      "pip" \
      "pyav" \
      "pkg-config" \
      "cairo" \
      "pango"
    ;;
  linux-* )
    micromamba create -y -p "$ROOT" -c conda-forge \
      "python=${PYTHON_VERSION}" \
      "manim=${MANIM_VERSION}" \
      "ffmpeg" \
      "pip" \
      "pyav" \
      "pkg-config" \
      "cairo" \
      "pango"
    ;;
  * )
    echo "Unsupported unix platform: $PLATFORM" >&2
    exit 1
    ;;
esac

micromamba run -p "$ROOT" python -m pip install -r "$REPO_ROOT/python/requirements/runtime-bridge.txt"

micromamba run -p "$ROOT" python --version
micromamba run -p "$ROOT" manim --version
micromamba run -p "$ROOT" ffmpeg -version
micromamba run -p "$ROOT" ffprobe -version
micromamba run -p "$ROOT" python -c "import manim"

OPENGL=false
if micromamba run -p "$ROOT" python -c "import moderngl, manim" >/dev/null 2>&1; then
  OPENGL=true
fi

micromamba run -p "$ROOT" manim -ql "$REPO_ROOT/examples/hello.py" HelloScene --renderer cairo >/dev/null 2>&1

node "$REPO_ROOT/scripts/write-runtime-metadata.mjs" \
  --runtime-root "$ROOT" \
  --version "$RUNTIME_VERSION" \
  --platform "$PLATFORM" \
  --python "bin/python" \
  --pip "bin/pip" \
  --manim "bin/manim" \
  --ffmpeg "bin/ffmpeg" \
  --ffprobe "bin/ffprobe" \
  --cairo true \
  --opengl "$OPENGL" \
  --providers "$PROVIDERS"
