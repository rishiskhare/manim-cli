from __future__ import annotations

import argparse
import json
import math
import os
import sys
import wave
from pathlib import Path


def cmd_duration(args: argparse.Namespace) -> int:
    path = Path(args.path)
    suffix = path.suffix.lower()
    if suffix != ".wav":
        raise RuntimeError("duration helper currently supports WAV files when ffprobe is unavailable")
    with wave.open(str(path), "rb") as handle:
        frames = handle.getnframes()
        rate = handle.getframerate()
        duration = frames / float(rate)
        sys.stdout.write(str(duration))
    return 0


def _ensure_parent(path: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)


def cmd_synth(args: argparse.Namespace) -> int:
    payload = json.loads(args.payload)
    provider = payload["provider"]
    output_path = payload["outputPath"]
    _ensure_parent(output_path)

    if provider == "openai":
      return synth_openai(payload)
    if provider == "kokoro-82m":
      return synth_kokoro(payload)
    if provider == "chatterbox-turbo":
      return synth_chatterbox(payload)
    if provider.startswith("qwen3-tts-12hz"):
      return synth_qwen(payload)
    raise RuntimeError(f"Unsupported provider: {provider}")


def cmd_caption_card(args: argparse.Namespace) -> int:
    from PIL import Image, ImageDraw, ImageFont
    import textwrap

    payload = json.loads(args.payload)
    text = payload["text"]
    output_path = payload["outputPath"]
    width = int(payload.get("width", 1280))
    height = int(payload.get("height", 160))
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    try:
        font = ImageFont.truetype("Arial Unicode.ttf", 36)
    except Exception:
        font = ImageFont.load_default()

    max_chars = max(20, width // 18)
    wrapped = textwrap.fill(text, width=max_chars)
    bbox = draw.multiline_textbbox((0, 0), wrapped, font=font, spacing=8)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    x = (width - text_width) / 2
    y = (height - text_height) / 2

    padding = 18
    draw.rounded_rectangle(
        (
            x - padding,
            y - padding,
            x + text_width + padding,
            y + text_height + padding,
        ),
        radius=18,
        fill=(0, 0, 0, 160),
    )
    draw.multiline_text((x, y), wrapped, font=font, fill=(255, 255, 255, 255), spacing=8, align="center")
    image.save(output_path)
    return 0


def synth_openai(payload: dict) -> int:
    from pathlib import Path
    from openai import OpenAI

    api_key = payload.get("openaiApiKey")
    if not api_key:
        raise RuntimeError("OpenAI API key missing")
    client = OpenAI(api_key=api_key)
    voice = payload.get("voice") or "alloy"
    model = payload.get("model") or "gpt-4o-mini-tts"
    out_path = Path(payload["outputPath"])
    with client.audio.speech.with_streaming_response.create(
        model=model,
        voice=voice,
        input=payload["text"],
        response_format="wav",
    ) as response:
        response.stream_to_file(out_path)
    return 0


def synth_kokoro(payload: dict) -> int:
    import soundfile as sf
    from kokoro import KPipeline

    language = payload.get("language", "en-US").lower()
    lang_code_map = {
        "en-us": "a",
        "en-gb": "b",
        "es-es": "e",
        "fr-fr": "f",
        "de-de": "d",
        "it-it": "i",
        "pt-br": "p",
        "ja-jp": "j",
        "zh-cn": "z",
    }
    pipeline = KPipeline(lang_code=lang_code_map.get(language, "a"))
    voice = payload.get("voice") or "af_heart"
    generator = pipeline(payload["text"], voice=voice, speed=payload.get("speed", 1))
    chunks = []
    sample_rate = 24000
    for _, _, audio in generator:
        chunks.append(audio)
    if not chunks:
        raise RuntimeError("Kokoro generated no audio")
    import numpy as np

    wav = np.concatenate(chunks)
    sf.write(payload["outputPath"], wav, sample_rate)
    return 0


def synth_chatterbox(payload: dict) -> int:
    import torchaudio as ta
    from chatterbox.tts_turbo import ChatterboxTurboTTS

    refs = payload.get("referenceAudio") or []
    if not refs:
        raise RuntimeError("Chatterbox-Turbo requires --reference-audio or a voice profile sample")
    model = ChatterboxTurboTTS.from_pretrained(device="cpu")
    wav = model.generate(payload["text"], audio_prompt_path=refs[0])
    ta.save(payload["outputPath"], wav, model.sr)
    return 0


def synth_qwen(payload: dict) -> int:
    import soundfile as sf
    from qwen_tts import Qwen3TTSModel

    model_id_map = {
        "qwen3-tts-12hz-0.6b-base": "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
        "qwen3-tts-12hz-1.7b-base": "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
        "qwen3-tts-12hz-0.6b-customvoice": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
        "qwen3-tts-12hz-1.7b-customvoice": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
    }
    model = Qwen3TTSModel.from_pretrained(model_id_map[payload["provider"]], device_map="cpu")
    text = payload["text"]
    language = payload.get("language", "English")
    if payload.get("cloningEnabled"):
        refs = payload.get("referenceAudio") or []
        if not refs:
            raise RuntimeError("Qwen custom voice requires reference audio")
        wavs, sample_rate = model.generate_voice_clone(
            text=text,
            language=language,
            ref_audio=refs[0],
            ref_text=text,
        )
    else:
        speaker = payload.get("voice") or None
        wavs, sample_rate = model.generate_custom_voice(
            text=text,
            language=language,
            speaker=speaker,
        )
    sf.write(payload["outputPath"], wavs[0], sample_rate)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    duration = subparsers.add_parser("duration")
    duration.add_argument("--path", required=True)
    duration.set_defaults(func=cmd_duration)

    synth = subparsers.add_parser("synth")
    synth.add_argument("--payload", required=True)
    synth.set_defaults(func=cmd_synth)

    caption_card = subparsers.add_parser("caption-card")
    caption_card.add_argument("--payload", required=True)
    caption_card.set_defaults(func=cmd_caption_card)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return args.func(args)
    except Exception as exc:  # pragma: no cover
        sys.stderr.write(f"{exc}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
