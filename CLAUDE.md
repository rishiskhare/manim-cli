# manim-cli guidance

Focus on correctness, release safety, and user-facing reliability.

Review priorities:
- runtime bootstrap and upgrade correctness
- npm packaging and published file payload
- GitHub Actions and release workflow robustness
- cross-platform behavior and renderer fallback handling
- TTS/provider setup failures that block end users

When reviewing pull requests:
- prioritize bugs, regressions, and missing validation over style
- call out missing tests when behavior changes
- prefer minimal, production-safe fixes
- avoid suggesting broad rewrites unless the current approach is unsound
