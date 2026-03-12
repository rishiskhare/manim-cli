import { execFile } from "../utils/process.js";

export async function openPath(filePath: string): Promise<void> {
  if (process.platform === "darwin") {
    await execFile("open", [filePath], { allowFailure: true });
    return;
  }
  if (process.platform === "win32") {
    await execFile("cmd", ["/c", "start", "", filePath], { allowFailure: true });
    return;
  }
  await execFile("xdg-open", [filePath], { allowFailure: true });
}
