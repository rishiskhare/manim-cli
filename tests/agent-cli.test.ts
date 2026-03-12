import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRun } from "../src/workspace/runs.js";

async function invokeCli(cwd: string, argv: string[]): Promise<{ stdout: string; exitCode: number }> {
  const originalCwd = process.cwd();
  const originalArgv = process.argv;
  const chunks: string[] = [];
  process.chdir(cwd);
  vi.resetModules();
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
    return true;
  }) as typeof process.stdout.write);

  process.env.XDG_CONFIG_HOME = path.join(cwd, ".xdg-config");
  process.env.XDG_CACHE_HOME = path.join(cwd, ".xdg-cache");
  process.env.XDG_DATA_HOME = path.join(cwd, ".xdg-data");
  process.argv = argv;
  const { runCli } = await import("../src/cli.js");
  process.exitCode = 0;
  try {
    await runCli(argv);
  } finally {
    spy.mockRestore();
    process.chdir(originalCwd);
    process.argv = originalArgv;
  }
  return { stdout: chunks.join(""), exitCode: process.exitCode ?? 0 };
}

describe("agent proposal cli", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.exitCode = 0;
  });

  test("propose emits proposal artifacts in json mode", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "manim-cli-test-"));
    const run = await createRun("Explain eigenvectors", cwd);
    const result = await invokeCli(cwd, ["node", "manim-cli", "agent", "propose", "--run", run.runId, "--json"]);
    const payload = JSON.parse(result.stdout);
    expect(payload.stage).toBe("proposal");
    expect(payload.data.proposalVersion).toBe(1);
    expect(payload.artifacts.proposalPath).toContain("proposal.json");
  });

  test("approve records approval and reject records rejection", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "manim-cli-test-"));
    const run = await createRun("Explain eigenvectors", cwd);
    await invokeCli(cwd, ["node", "manim-cli", "agent", "propose", "--run", run.runId, "--json"]);

    const approved = await invokeCli(cwd, [
      "node",
      "manim-cli",
      "agent",
      "approve",
      "--run",
      run.runId,
      "--proposal-version",
      "1",
      "--json"
    ]);
    expect(JSON.parse(approved.stdout).data.approvalStatus).toBe("approved");

    await invokeCli(cwd, ["node", "manim-cli", "agent", "propose", "--run", run.runId, "--json"]);
    const rejected = await invokeCli(cwd, [
      "node",
      "manim-cli",
      "agent",
      "reject",
      "--run",
      run.runId,
      "--reason",
      "Needs a better example",
      "--json"
    ]);
    expect(JSON.parse(rejected.stdout).data.approvalStatus).toBe("rejected");
  });

  test("agent run is blocked before proposal approval", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "manim-cli-test-"));
    const run = await createRun("Explain eigenvectors", cwd);
    const result = await invokeCli(cwd, ["node", "manim-cli", "agent", "run", "--run", run.runId, "--json"]);
    const payload = JSON.parse(result.stdout);
    expect(result.exitCode).toBe(1);
    expect(payload.errors[0].code).toBe("PROPOSAL_APPROVAL_REQUIRED");
  });
});
