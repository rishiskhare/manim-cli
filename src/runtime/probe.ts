import path from "node:path";
import { execFile } from "../utils/process.js";
import { loadRuntimeMetadata } from "./locator.js";
import { getManagedFfmpegBin, getManagedFfprobeBin, getManagedManimBin, getManagedPythonBin } from "./locator.js";

export type RendererProbe = {
  cairo: "available" | "degraded" | "unavailable";
  opengl: "available" | "degraded" | "unavailable";
};

export type RuntimeProbe = {
  runtimeVersion: string | null;
  python: boolean;
  manim: boolean;
  ffmpeg: boolean;
  ffprobe: boolean;
  renderers: RendererProbe;
};

export async function probeManagedRuntime(): Promise<RuntimeProbe> {
  const pythonBin = await getManagedPythonBin();
  const manimBin = await getManagedManimBin();
  const ffmpegBin = await getManagedFfmpegBin();
  const ffprobeBin = await getManagedFfprobeBin();
  return probeRuntimeAt({
    pythonBin,
    manimBin,
    ffmpegBin,
    ffprobeBin
  });
}

export async function probeRuntimeAt(paths: {
  pythonBin: string;
  manimBin: string;
  ffmpegBin: string;
  ffprobeBin: string;
}): Promise<RuntimeProbe> {
  const metadata = await loadRuntimeMetadata(path.dirname(path.dirname(paths.pythonBin)));

  const python = (await execFile(paths.pythonBin, ["--version"], { allowFailure: true })).code === 0;
  const manimVersion = await execFile(paths.manimBin, ["--version"], { allowFailure: true });
  const ffmpeg = (await execFile(paths.ffmpegBin, ["-version"], { allowFailure: true })).code === 0;
  const ffprobe = (await execFile(paths.ffprobeBin, ["-version"], { allowFailure: true })).code === 0;
  const cairoSupported = metadata.features?.cairo ?? true;
  const openglSupported = metadata.features?.opengl ?? true;
  const cairo = !cairoSupported
    ? "unavailable"
    : (await execFile(paths.pythonBin, ["-c", "import manim"], { allowFailure: true })).code === 0
      ? "available"
      : "degraded";
  const opengl = !openglSupported
    ? "unavailable"
    : (await execFile(paths.pythonBin, ["-c", "import moderngl, manim"], { allowFailure: true })).code === 0
      ? "available"
      : "degraded";

  return {
    runtimeVersion: manimVersion.code === 0 ? manimVersion.stdout.trim() || manimVersion.stderr.trim() : null,
    python,
    manim: manimVersion.code === 0,
    ffmpeg,
    ffprobe,
    renderers: {
      cairo,
      opengl
    }
  };
}
