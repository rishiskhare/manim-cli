param(
  [Parameter(Mandatory = $true)][string]$RuntimeRoot,
  [Parameter(Mandatory = $true)][string]$Platform,
  [Parameter(Mandatory = $true)][string]$RuntimeVersion,
  [string]$ManimVersion = "0.20.1",
  [string]$PythonVersion = "3.11",
  [string]$Providers = "kokoro-82m,openai,qwen3-tts-12hz-0.6b-base,qwen3-tts-12hz-1.7b-base,qwen3-tts-12hz-0.6b-customvoice,qwen3-tts-12hz-1.7b-customvoice,chatterbox-turbo"
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

if (-not (Get-Command micromamba -ErrorAction SilentlyContinue)) {
  throw "micromamba is required on PATH"
}

if (Test-Path $RuntimeRoot) {
  Remove-Item -Recurse -Force $RuntimeRoot
}

micromamba create -y -p $RuntimeRoot -c conda-forge `
  "python=$PythonVersion" `
  "manim=$ManimVersion" `
  "ffmpeg" `
  "pip" `
  "pyav"

micromamba run -p $RuntimeRoot python -m pip install -r (Join-Path $RepoRoot "python/requirements/runtime-bridge.txt")

micromamba run -p $RuntimeRoot python --version
micromamba run -p $RuntimeRoot manim --version
micromamba run -p $RuntimeRoot ffmpeg -version
micromamba run -p $RuntimeRoot ffprobe -version
micromamba run -p $RuntimeRoot python -c "import manim"

$openGl = "false"
try {
  micromamba run -p $RuntimeRoot python -c "import moderngl, manim" | Out-Null
  $openGl = "true"
} catch {
  $openGl = "false"
}

micromamba run -p $RuntimeRoot manim -ql (Join-Path $RepoRoot "examples/hello.py") HelloScene --renderer cairo | Out-Null

node (Join-Path $RepoRoot "scripts/write-runtime-metadata.mjs") `
  --runtime-root $RuntimeRoot `
  --version $RuntimeVersion `
  --platform $Platform `
  --python "Scripts/python.exe" `
  --pip "Scripts/pip.exe" `
  --manim "Scripts/manim.exe" `
  --ffmpeg "Library/bin/ffmpeg.exe" `
  --ffprobe "Library/bin/ffprobe.exe" `
  --cairo true `
  --opengl $openGl `
  --providers $Providers
