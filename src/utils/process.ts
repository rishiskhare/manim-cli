import { spawn } from "node:child_process";

export type ExecOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  allowFailure?: boolean;
  stdout?: "pipe" | "inherit";
  stderr?: "pipe" | "inherit";
  timeoutMs?: number;
};

export type ExecResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export async function execFile(
  command: string,
  args: string[],
  options: ExecOptions = {}
): Promise<ExecResult> {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: [
      "ignore",
      options.stdout === "inherit" ? "inherit" : "pipe",
      options.stderr === "inherit" ? "inherit" : "pipe"
    ]
  });

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let timeout: NodeJS.Timeout | undefined;

  if (child.stdout) {
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
  }
  if (child.stderr) {
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
  }

  if (options.timeoutMs && options.timeoutMs > 0) {
    timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs);
  }

  const code = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (exitCode) => resolve(exitCode ?? 1));
  });

  if (timeout) {
    clearTimeout(timeout);
  }

  if (timedOut) {
    throw new Error(`Command timed out after ${options.timeoutMs}ms (${command} ${args.join(" ")})`);
  }

  if (code !== 0 && !options.allowFailure) {
    throw new Error(`Command failed (${command} ${args.join(" ")}): ${stderr || stdout}`.trim());
  }

  return { code, stdout, stderr };
}
