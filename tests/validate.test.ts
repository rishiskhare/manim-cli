import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { CliError } from "../src/errors.js";
import { createProposal, createScaffoldFromProposal, renderProposalMarkdown } from "../src/templates.js";
import { validateRun } from "../src/pipeline/validate.js";
import { createRun, loadManifest, saveManifest, writeProposalFiles, writeScaffoldFiles } from "../src/workspace/runs.js";

describe("proposal-aware validation", () => {
  test("rejects storyboard that diverges from the approved proposal", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "manim-cli-test-"));
    const run = await createRun("Explain eigenvectors", cwd);
    const proposal = createProposal("Explain eigenvectors");
    await writeProposalFiles(run.runId, proposal, renderProposalMarkdown(proposal, 1), cwd);
    const scaffold = createScaffoldFromProposal(proposal);
    scaffold.storyboard.scenes[0] = {
      ...scaffold.storyboard.scenes[0]!,
      id: "wrong_section"
    };
    await writeScaffoldFiles(run.runId, scaffold.storyboard, scaffold.narration, scaffold.pythonSource, cwd);
    const manifest = await loadManifest(run.runId, cwd);
    manifest.proposalVersion = 1;
    manifest.proposalStatus = "approved";
    manifest.approvedProposalVersion = 1;
    await saveManifest(run.runId, manifest, cwd);

    await expect(validateRun(run.runId, cwd)).rejects.toMatchObject<CliError>({
      code: "PROPOSAL_SECTION_MISMATCH"
    });
  });

  test("returns warnings for duration drift", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "manim-cli-test-"));
    const run = await createRun("Explain eigenvectors", cwd);
    const proposal = createProposal("Explain eigenvectors");
    await writeProposalFiles(run.runId, proposal, renderProposalMarkdown(proposal, 1), cwd);
    const scaffold = createScaffoldFromProposal(proposal);
    scaffold.storyboard.scenes[0] = {
      ...scaffold.storyboard.scenes[0]!,
      targetDurationSec: scaffold.storyboard.scenes[0]!.targetDurationSec + 5
    };
    await writeScaffoldFiles(run.runId, scaffold.storyboard, scaffold.narration, scaffold.pythonSource, cwd);
    const manifest = await loadManifest(run.runId, cwd);
    manifest.proposalVersion = 1;
    manifest.proposalStatus = "approved";
    manifest.approvedProposalVersion = 1;
    await saveManifest(run.runId, manifest, cwd);

    const result = await validateRun(run.runId, cwd);
    expect(result.warnings[0]).toContain("drifts from approved proposal");
  });
});
