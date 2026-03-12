import { execFile } from "./process.js";
import { getManagedFfprobeBin } from "../runtime/locator.js";
import { runPythonBridge } from "../runtime/python.js";

export async function getMediaDurationSeconds(filePath: string): Promise<number> {
  try {
    const ffprobe = await getManagedFfprobeBin();
    const result = await execFile(
      ffprobe,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath
      ],
      { allowFailure: true }
    );
    const parsed = Number(result.stdout.trim());
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  } catch {
    // fall through to python helper
  }

  const result = await runPythonBridge(["duration", "--path", filePath]);
  return Number(result);
}

export async function getVideoDimensions(filePath: string): Promise<{ width: number; height: number }> {
  const ffprobe = await getManagedFfprobeBin();
  const result = await execFile(
    ffprobe,
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0:s=x",
      filePath
    ]
  );
  const [width, height] = result.stdout.trim().split("x").map((value) => Number(value));
  return { width, height };
}
