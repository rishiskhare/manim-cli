import fs from "node:fs/promises";
import path from "node:path";

export async function acquireRunLock(runPath: string): Promise<() => Promise<void>> {
  const lockPath = path.join(runPath, ".lock");
  const handle = await fs.open(lockPath, "wx");
  await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }, null, 2));
  return async () => {
    await handle.close();
    await fs.rm(lockPath, { force: true });
  };
}
