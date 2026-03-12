import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { appendStageHistory, createRun, ensureProposalApproved, loadManifest, saveManifest } from "../src/workspace/runs.js";
import { CliError } from "../src/errors.js";

describe("manifest lifecycle", () => {
  test("records stage history", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "manim-cli-test-"));
    const run = await createRun("Prompt", cwd);
    await appendStageHistory(run.runId, "validate", "completed", { ok: true }, cwd);
    const manifest = await loadManifest(run.runId, cwd);
    expect(manifest.stageHistory).toHaveLength(1);
    expect(manifest.stageHistory[0]?.stage).toBe("validate");
    expect(manifest.approvalRequired).toBe(true);
    expect(manifest.proposalStatus).toBe("pending");
  });

  test("allows direct runs to bypass proposal approval", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "manim-cli-test-"));
    const run = await createRun("Prompt", cwd, { approvalRequired: false });
    const manifest = await ensureProposalApproved(run.runId, cwd);
    expect(manifest.approvalRequired).toBe(false);
  });

  test("blocks unapproved agent runs", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "manim-cli-test-"));
    const run = await createRun("Prompt", cwd);
    await expect(ensureProposalApproved(run.runId, cwd)).rejects.toMatchObject<CliError>({
      code: "PROPOSAL_APPROVAL_REQUIRED"
    });
  });

  test("accepts approved proposal version", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "manim-cli-test-"));
    const run = await createRun("Prompt", cwd);
    const manifest = await loadManifest(run.runId, cwd);
    manifest.proposalVersion = 2;
    manifest.proposalStatus = "approved";
    manifest.approvedProposalVersion = 2;
    await saveManifest(run.runId, manifest, cwd);
    await expect(ensureProposalApproved(run.runId, cwd)).resolves.toMatchObject({
      proposalStatus: "approved"
    });
  });
});
