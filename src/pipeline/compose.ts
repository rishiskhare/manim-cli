import fs from "node:fs/promises";
import path from "node:path";
import { CliError } from "../errors.js";
import { getMediaDurationSeconds, getVideoDimensions } from "../utils/audio.js";
import { fileExists } from "../utils/fs.js";
import { execFile } from "../utils/process.js";
import { loadStoryboard } from "../workspace/runs.js";
import type { ProgressReporter } from "../ui/progress.js";
import { runPythonBridge } from "../runtime/python.js";
import { getManagedFfmpegBin } from "../runtime/locator.js";

export async function composeRun(
  runId: string,
  subtitleMode: "none" | "srt" | "burned" = "none",
  cwd = process.cwd(),
  reporter?: ProgressReporter
): Promise<string> {
  const runPath = path.join(cwd, ".manim-cli", "runs", runId);
  const storyboard = await loadStoryboard(runId, cwd);
  const ffmpeg = await getManagedFfmpegBin();
  const concatEntries: string[] = [];
  let currentStart = 0;
  const subtitles: string[] = [];
  const timedCaptions: Array<{ text: string; start: number; end: number }> = [];
  const useAudio = await fileExists(path.join(runPath, "artifacts", `${storyboard.scenes[0]?.id}.wav`));

  for (const [index, scene] of storyboard.scenes.entries()) {
    reporter?.scene(index + 1, storyboard.scenes.length, `compose ${scene.id}`);
    const videoDir = path.join(runPath, "media", "videos");
    const sceneVideo = await findRenderedSceneFile(videoDir, scene.manimSceneClass);
    const sceneAudio = path.join(runPath, "artifacts", `${scene.id}.wav`);
    const videoDuration = await getMediaDurationSeconds(sceneVideo);
    let effectiveDuration = videoDuration;
    let composedScene = sceneVideo;
    if (useAudio) {
      const audioDuration = await getMediaDurationSeconds(sceneAudio);
      effectiveDuration = Math.max(audioDuration, videoDuration);
      const paddedVideo = path.join(runPath, "artifacts", `${scene.id}.mp4`);
      let muxAudio = sceneAudio;
      if (videoDuration + 0.05 < audioDuration) {
        const pad = audioDuration - videoDuration;
        await execFile(ffmpeg, ["-y", "-i", sceneVideo, "-vf", `tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)}`, "-an", paddedVideo], {
          stdout: "inherit",
          stderr: "inherit"
        });
      } else {
        await fs.copyFile(sceneVideo, paddedVideo);
      }

      if (audioDuration + 0.05 < videoDuration) {
        const paddedAudio = path.join(runPath, "artifacts", `${scene.id}.padded.wav`);
        reporter?.status("info", `Padding narration with ${(videoDuration - audioDuration).toFixed(2)}s of trailing silence for ${scene.id}`);
        await execFile(
          ffmpeg,
          [
            "-y",
            "-i",
            sceneAudio,
            "-af",
            `apad=pad_dur=${(videoDuration - audioDuration).toFixed(3)}`,
            "-t",
            videoDuration.toFixed(3),
            paddedAudio
          ],
          {
            stdout: "inherit",
            stderr: "inherit"
          }
        );
        muxAudio = paddedAudio;
      }

      const muxed = path.join(runPath, "artifacts", `${scene.id}.muxed.mp4`);
      await execFile(ffmpeg, ["-y", "-i", paddedVideo, "-i", muxAudio, "-c:v", "copy", "-c:a", "aac", muxed], {
        stdout: "inherit",
        stderr: "inherit"
      });
      composedScene = muxed;
    }
    concatEntries.push(`file '${composedScene.replace(/'/g, "'\\''")}'`);

    if (subtitleMode !== "none") {
      subtitles.push(
        `${subtitles.length + 1}\n${formatSrtTime(currentStart)} --> ${formatSrtTime(currentStart + effectiveDuration)}\n${scene.narrationText}\n`
      );
      timedCaptions.push({
        text: scene.narrationText,
        start: currentStart,
        end: currentStart + effectiveDuration
      });
    }
    currentStart += effectiveDuration;
  }

  const concatPath = path.join(runPath, "artifacts", "concat.txt");
  await fs.writeFile(concatPath, `${concatEntries.join("\n")}\n`, "utf8");
  const outputPath = path.join(runPath, "artifacts", "final.mp4");
  reporter?.step("Muxing final video");
  await execFile(ffmpeg, ["-y", "-f", "concat", "-safe", "0", "-i", concatPath, "-c", "copy", outputPath], {
    stdout: "inherit",
    stderr: "inherit"
  });

  if (subtitleMode !== "none") {
    const subtitlePath = path.join(runPath, "artifacts", "subtitles.srt");
    await fs.writeFile(subtitlePath, `${subtitles.join("\n")}\n`, "utf8");
    if (subtitleMode === "burned") {
      const burnedPath = path.join(runPath, "artifacts", "final.captioned.mp4");
      reporter?.step("Burning captions into final video");
      if (await ffmpegHasFilter(ffmpeg, "subtitles")) {
        await execFile(ffmpeg, ["-y", "-i", outputPath, "-vf", `subtitles=filename='${escapeFilterPath(subtitlePath)}'`, "-c:a", "copy", burnedPath], {
          stdout: "inherit",
          stderr: "inherit"
        });
      } else if (await ffmpegHasFilter(ffmpeg, "drawtext")) {
        await burnCaptionsWithDrawtext(ffmpeg, outputPath, burnedPath, timedCaptions, reporter);
      } else {
        await burnCaptionsWithOverlay(ffmpeg, outputPath, burnedPath, timedCaptions, runPath, reporter);
      }
      return burnedPath;
    }
  }

  return outputPath;
}

async function findRenderedSceneFile(root: string, sceneClass: string): Promise<string> {
  const candidates = await walk(root);
  const match = candidates.find((file) => path.basename(file).includes(sceneClass) && file.endsWith(".mp4"));
  if (!match) {
    throw new CliError("COMPOSE_FAILED", `Could not locate rendered output for ${sceneClass}`);
  }
  return match;
}

async function walk(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walk(full)));
    } else {
      results.push(full);
    }
  }
  return results;
}

function formatSrtTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const milliseconds = Math.floor((totalSeconds - Math.floor(totalSeconds)) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}

function escapeFilterPath(filePath: string): string {
  return filePath.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/,/g, "\\,").replace(/'/g, "'\\''");
}

function escapeDrawtextText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/%/g, "\\%")
    .replace(/\n/g, "\\n");
}

let ffmpegFilterCache: string | null = null;

async function ffmpegHasFilter(ffmpegBin: string, filterName: string): Promise<boolean> {
  if (ffmpegFilterCache === null) {
    const result = await execFile(ffmpegBin, ["-filters"], { allowFailure: true });
    ffmpegFilterCache = `${result.stdout}\n${result.stderr}`;
  }
  return new RegExp(`\\b${filterName}\\b`).test(ffmpegFilterCache);
}

async function burnCaptionsWithDrawtext(
  ffmpegBin: string,
  inputPath: string,
  outputPath: string,
  captions: Array<{ text: string; start: number; end: number }>,
  reporter?: ProgressReporter
): Promise<void> {
  reporter?.status("warning", "ffmpeg subtitles filter unavailable, using drawtext fallback");
  const filters: string[] = [];

  for (const caption of captions) {
    filters.push(
      [
        `drawtext=text='${escapeDrawtextText(caption.text)}'`,
        "fontcolor=white",
        "fontsize=28",
        "line_spacing=8",
        "box=1",
        "boxcolor=black@0.55",
        "boxborderw=18",
        "x=(w-text_w)/2",
        "y=h-text_h-48",
        `enable='between(t,${caption.start.toFixed(3)},${caption.end.toFixed(3)})'`
      ].join(":")
    );
  }

  await execFile(ffmpegBin, ["-y", "-i", inputPath, "-vf", filters.join(","), "-c:a", "copy", outputPath], {
    stdout: "inherit",
    stderr: "inherit"
  });
}

async function burnCaptionsWithOverlay(
  ffmpegBin: string,
  inputPath: string,
  outputPath: string,
  captions: Array<{ text: string; start: number; end: number }>,
  runPath: string,
  reporter?: ProgressReporter
): Promise<void> {
  reporter?.status("warning", "ffmpeg text filters unavailable, using generated caption overlays");
  const { width } = await getVideoDimensions(inputPath);
  const videoDuration = await getMediaDurationSeconds(inputPath);
  const captionInputs: string[] = [];
  const filterParts: string[] = [];
  let currentLabel = "[0:v]";

  for (const [index, caption] of captions.entries()) {
    const cardPath = path.join(runPath, "artifacts", `caption-${index + 1}.png`);
    await runPythonBridge([
      "caption-card",
      "--payload",
      JSON.stringify({
        text: caption.text,
        outputPath: cardPath,
        width,
        height: 160
      })
    ]);
    captionInputs.push("-loop", "1", "-t", videoDuration.toFixed(3), "-i", cardPath);
    const nextLabel = index === captions.length - 1 ? "[vout]" : `[v${index + 1}]`;
    filterParts.push(
      `${currentLabel}[${index + 1}:v]overlay=x=(main_w-overlay_w)/2:y=main_h-overlay_h-32:enable='between(t,${caption.start.toFixed(3)},${caption.end.toFixed(3)})'${nextLabel}`
    );
    currentLabel = nextLabel;
  }

  await execFile(
    ffmpegBin,
    [
      "-y",
      "-i",
      inputPath,
      ...captionInputs,
      "-filter_complex",
      filterParts.join(";"),
      "-map",
      "[vout]",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-shortest",
      "-c:a",
      "copy",
      outputPath
    ],
    {
      stdout: "inherit",
      stderr: "inherit"
    }
  );
}
