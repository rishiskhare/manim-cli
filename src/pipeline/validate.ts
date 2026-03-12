import fs from "node:fs/promises";
import path from "node:path";
import { CliError } from "../errors.js";
import { ensureProposalApproved, loadNarration, loadProposal, loadStoryboard } from "../workspace/runs.js";

const DURATION_DRIFT_RATIO = 0.2;
const DURATION_DRIFT_SECONDS = 2;

export async function validateRun(runId: string, cwd = process.cwd()): Promise<{ sceneClasses: string[]; warnings: string[] }> {
  const manifest = await ensureProposalApproved(runId, cwd);
  const storyboard = await loadStoryboard(runId, cwd);
  await loadNarration(runId, cwd);
  const runPath = path.join(cwd, ".manim-cli", "runs", runId);
  const videoPath = path.join(runPath, "video.py");
  const source = await fs.readFile(videoPath, "utf8");
  const warnings: string[] = [];

  if (manifest.approvalRequired) {
    const proposal = await loadProposal(runId, cwd);
    if (manifest.approvedProposalVersion !== manifest.proposalVersion) {
      throw new CliError("PROPOSAL_VERSION_CONFLICT", `Run ${runId} has an outdated approval for proposal version ${manifest.approvedProposalVersion ?? "unknown"}.`, {
        proposalVersion: manifest.proposalVersion,
        approvedProposalVersion: manifest.approvedProposalVersion
      });
    }

    if (storyboard.scenes.length !== proposal.sections.length) {
      throw new CliError("PROPOSAL_SECTION_MISMATCH", `Storyboard scene count (${storyboard.scenes.length}) does not match approved proposal section count (${proposal.sections.length}).`);
    }

    for (const [index, section] of proposal.sections.entries()) {
      const scene = storyboard.scenes[index];
      if (!scene || scene.id !== section.id) {
        throw new CliError("PROPOSAL_SECTION_MISMATCH", `Storyboard scene order must match the approved proposal. Expected ${section.id} at position ${index + 1}.`);
      }
      const drift = Math.abs(scene.targetDurationSec - section.targetDurationSec);
      if (drift > Math.max(DURATION_DRIFT_SECONDS, section.targetDurationSec * DURATION_DRIFT_RATIO)) {
        warnings.push(
          `Scene ${scene.id} target duration (${scene.targetDurationSec}s) drifts from approved proposal (${section.targetDurationSec}s).`
        );
      }
    }
  }

  const missing = storyboard.scenes
    .map((scene) => scene.manimSceneClass)
    .filter((className) => !new RegExp(`class\\s+${className}\\s*\\(`).test(source));
  if (missing.length > 0) {
    throw new CliError("SCENE_MAPPING_MISSING", `Missing Manim scene classes: ${missing.join(", ")}`);
  }
  return { sceneClasses: storyboard.scenes.map((scene) => scene.manimSceneClass), warnings };
}
