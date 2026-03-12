import path from "node:path";
import { CliError } from "../errors.js";
import { execFile } from "../utils/process.js";
import { getManagedManimBin, bootstrapRuntime } from "../runtime/python.js";
import { getManagedRuntimeEnv } from "../runtime/locator.js";
import { probeManagedRuntime } from "../runtime/probe.js";
import { mapManimOptionsToArgs, type RenderOptions } from "./options.js";
import type { ProgressReporter } from "../ui/progress.js";

export async function renderManimFile(
  file: string,
  scenes: string[],
  options: RenderOptions,
  cwd = process.cwd(),
  reporter?: ProgressReporter
): Promise<void> {
  await bootstrapRuntime(reporter);
  if (options.renderer === "opengl") {
    const probe = await probeManagedRuntime();
    if (probe.renderers.opengl !== "available") {
      throw new CliError(
        "RENDERER_UNAVAILABLE",
        "The managed runtime does not support the OpenGL renderer on this platform. Try --renderer cairo instead.",
        { rendererStatus: probe.renderers.opengl }
      );
    }
  }
  reporter?.step("Invoking Manim Community renderer", options.renderer ?? "cairo");
  const manimBin = await getManagedManimBin();
  const env = await getManagedRuntimeEnv();
  const commandArgs = [
    ...mapManimOptionsToArgs(options),
    path.resolve(cwd, file),
    ...scenes
  ];
  const result = await execFile(manimBin, commandArgs, {
    cwd,
    env,
    stdout: "inherit",
    stderr: "inherit",
    allowFailure: true
  });
  if (result.code !== 0) {
    throw new CliError("MANIM_RENDER_FAILED", `Manim render failed for ${file}`);
  }
}
