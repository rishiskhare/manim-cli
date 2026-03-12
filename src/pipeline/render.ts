import fs from "node:fs/promises";
import path from "node:path";
import { loadStoryboard } from "../workspace/runs.js";
import { renderManimFile } from "../manim/render.js";
import type { RenderOptions } from "../manim/options.js";
import { CliError } from "../errors.js";
import type { ProgressReporter } from "../ui/progress.js";

export async function renderRun(
  runId: string,
  options: RenderOptions,
  cwd = process.cwd(),
  reporter?: ProgressReporter
): Promise<Record<string, string>> {
  const storyboard = await loadStoryboard(runId, cwd);
  const runPath = path.join(cwd, ".manim-cli", "runs", runId);
  const videoPath = path.join(runPath, "video.py");
  const outputs: Record<string, string> = {};
  for (const [index, scene] of storyboard.scenes.entries()) {
    reporter?.scene(index + 1, storyboard.scenes.length, scene.manimSceneClass);
    await renderManimFile(videoPath, [scene.manimSceneClass], options, runPath, reporter);
    outputs[scene.id] = await findRenderedSceneFile(path.join(runPath, "media", "videos"), scene.manimSceneClass);
  }
  return outputs;
}

async function findRenderedSceneFile(root: string, sceneClass: string): Promise<string> {
  const candidates = await walk(root);
  const match = candidates.find((file) => path.basename(file).includes(sceneClass) && file.endsWith(".mp4"));
  if (!match) {
    throw new CliError("MANIM_RENDER_FAILED", `Could not locate rendered output for ${sceneClass}`);
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
