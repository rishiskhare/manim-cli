import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { ensureDir, readJsonFile, writeJsonFile } from "../utils/fs.js";
import { CliError } from "../errors.js";
import {
  manifestSchema,
  narrationSchema,
  proposalSchema,
  storyboardSchema,
  type Manifest,
  type NarrationConfig,
  type Proposal,
  type Storyboard
} from "./schemas.js";

export function getRunsRoot(cwd = process.cwd()): string {
  return path.join(cwd, ".manim-cli", "runs");
}

export function getRunPath(runId: string, cwd = process.cwd()): string {
  return path.join(getRunsRoot(cwd), runId);
}

export async function createRun(
  prompt: string,
  cwd = process.cwd(),
  options: { approvalRequired?: boolean } = {}
): Promise<{ runId: string; runPath: string; manifest: Manifest }> {
  const runId = crypto.randomUUID();
  const runPath = getRunPath(runId, cwd);
  await ensureDir(path.join(runPath, "artifacts"));
  await ensureDir(path.join(runPath, "logs"));
  const approvalRequired = options.approvalRequired ?? true;
  const manifest: Manifest = {
    runId,
    createdAt: new Date().toISOString(),
    prompt,
    stage: "init",
    stageHistory: [],
    artifacts: {},
    routingDecisions: [],
    approvalRequired,
    proposalStatus: approvalRequired ? "pending" : "approved",
    proposalVersion: 0,
    approvedProposalVersion: approvalRequired ? undefined : 0,
    approvedAt: approvalRequired ? undefined : new Date().toISOString(),
    rejectionReason: undefined,
    errors: []
  };
  await writeJsonFile(path.join(runPath, "request.json"), { prompt });
  await writeJsonFile(path.join(runPath, "manifest.json"), manifest);
  return { runId, runPath, manifest };
}

export async function loadManifest(runId: string, cwd = process.cwd()): Promise<Manifest> {
  const manifest = await readJsonFile<Manifest>(path.join(getRunPath(runId, cwd), "manifest.json"));
  return manifestSchema.parse(manifest);
}

export async function saveManifest(runId: string, manifest: Manifest, cwd = process.cwd()): Promise<void> {
  await writeJsonFile(path.join(getRunPath(runId, cwd), "manifest.json"), manifest);
}

export async function appendStageHistory(
  runId: string,
  stage: string,
  status: "started" | "completed" | "failed",
  details?: Record<string, unknown>,
  cwd = process.cwd()
): Promise<Manifest> {
  const manifest = await loadManifest(runId, cwd);
  manifest.stageHistory.push({
    stage,
    status,
    timestamp: new Date().toISOString(),
    details
  });
  if (status === "completed" && stage === "compose") {
    manifest.stage = "completed";
  } else if (status !== "failed") {
    manifest.stage = stage as Manifest["stage"];
  }
  await saveManifest(runId, manifest, cwd);
  return manifest;
}

export async function recordManifestError(runId: string, code: string, message: string, cwd = process.cwd()): Promise<void> {
  const manifest = await loadManifest(runId, cwd);
  manifest.errors.push({ code, message, timestamp: new Date().toISOString() });
  await saveManifest(runId, manifest, cwd);
}

export async function loadStoryboard(runId: string, cwd = process.cwd()): Promise<Storyboard> {
  return storyboardSchema.parse(await readJsonFile(path.join(getRunPath(runId, cwd), "storyboard.json")));
}

export async function loadProposal(runId: string, cwd = process.cwd()): Promise<Proposal> {
  try {
    return proposalSchema.parse(await readJsonFile(path.join(getRunPath(runId, cwd), "proposal.json")));
  } catch (error) {
    throw new CliError("PROPOSAL_NOT_FOUND", `Proposal not found for run ${runId}`, {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function loadNarration(runId: string, cwd = process.cwd()): Promise<NarrationConfig> {
  return narrationSchema.parse(await readJsonFile(path.join(getRunPath(runId, cwd), "narration.json")));
}

export async function writeProposalFiles(runId: string, proposal: Proposal, markdown: string, cwd = process.cwd()): Promise<void> {
  const runPath = getRunPath(runId, cwd);
  await writeJsonFile(path.join(runPath, "proposal.json"), proposal);
  await fs.writeFile(path.join(runPath, "proposal.md"), markdown, "utf8");
}

export async function writeScaffoldFiles(runId: string, storyboard: Storyboard, narration: NarrationConfig, pythonSource: string, cwd = process.cwd()): Promise<void> {
  const runPath = getRunPath(runId, cwd);
  await writeJsonFile(path.join(runPath, "storyboard.json"), storyboard);
  await writeJsonFile(path.join(runPath, "narration.json"), narration);
  await fs.writeFile(path.join(runPath, "video.py"), pythonSource, "utf8");
}

export async function ensureProposalApproved(runId: string, cwd = process.cwd()): Promise<Manifest> {
  const manifest = await loadManifest(runId, cwd);
  if (!manifest.approvalRequired) {
    return manifest;
  }
  if (manifest.proposalStatus === "rejected") {
    throw new CliError("PROPOSAL_REJECTED", manifest.rejectionReason ?? `Proposal for run ${runId} has been rejected.`);
  }
  if (manifest.proposalStatus !== "approved" || manifest.approvedProposalVersion !== manifest.proposalVersion || manifest.proposalVersion === 0) {
    throw new CliError("PROPOSAL_APPROVAL_REQUIRED", `Run ${runId} requires an approved proposal before scaffolding or rendering.`, {
      proposalStatus: manifest.proposalStatus,
      proposalVersion: manifest.proposalVersion,
      approvedProposalVersion: manifest.approvedProposalVersion
    });
  }
  return manifest;
}
