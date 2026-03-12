import path from "node:path";
import type { RenderOptions } from "../manim/options.js";
import { appendStageHistory } from "../workspace/runs.js";
import { validateRun } from "./validate.js";
import { renderRun } from "./render.js";
import { synthesizeRun } from "./tts.js";
import { composeRun } from "./compose.js";
import type { ProgressReporter } from "../ui/progress.js";

export async function runPipeline(
  runId: string,
  options: RenderOptions,
  cwd = process.cwd(),
  reporter?: ProgressReporter
): Promise<{ finalVideo: string }> {
  reporter?.banner(`Run ${runId}`);
  reporter?.stage(1, 4, "Validate");
  await appendStageHistory(runId, "validate", "started", undefined, cwd);
  await validateRun(runId, cwd);
  await appendStageHistory(runId, "validate", "completed", undefined, cwd);
  reporter?.status("success", "Validation complete");

  reporter?.stage(2, 4, "Render");
  await appendStageHistory(runId, "render", "started", undefined, cwd);
  const renderOutputs = await renderRun(runId, options, cwd, reporter);
  await appendStageHistory(runId, "render", "completed", { renderOutputs }, cwd);
  reporter?.status("success", "Render complete");

  if (options.tts) {
    reporter?.stage(3, 4, "Narration");
    await appendStageHistory(runId, "tts", "started", undefined, cwd);
    await synthesizeRun(runId, options, cwd, reporter);
    await appendStageHistory(runId, "tts", "completed", undefined, cwd);
    reporter?.status("success", "Narration complete");
  } else {
    reporter?.stage(3, 4, "Narration", "skipped");
  }

  reporter?.stage(4, 4, "Compose");
  await appendStageHistory(runId, "compose", "started", undefined, cwd);
  const needsCompose = options.tts || options.subtitleMode !== "none" || Object.keys(renderOutputs).length > 1;
  const finalVideo = needsCompose
    ? await composeRun(runId, options.subtitleMode, cwd, reporter)
    : Object.values(renderOutputs)[0]!;
  await appendStageHistory(runId, "compose", "completed", { finalVideo }, cwd);
  reporter?.status("success", `Output ready: ${finalVideo}`);
  return { finalVideo };
}
