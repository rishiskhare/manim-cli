import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { createProposal, createScaffoldFromProposal, renderProposalMarkdown } from "./templates.js";
import { printOutput } from "./output.js";
import { CliError } from "./errors.js";
import { bootstrapRuntime, ensureManagedRuntime, repairRuntime } from "./runtime/python.js";
import { collectDoctorReport } from "./runtime/doctor.js";
import { loadConfig, setConfigValue } from "./config/store.js";
import { deleteSecret, promptHidden, setSecret } from "./config/secret.js";
import {
  appendStageHistory,
  createRun,
  ensureProposalApproved,
  getRunPath,
  loadManifest,
  loadProposal,
  saveManifest,
  writeProposalFiles,
  writeScaffoldFiles
} from "./workspace/runs.js";
import { validateRun } from "./pipeline/validate.js";
import { renderRun } from "./pipeline/render.js";
import { synthesizeRun } from "./pipeline/tts.js";
import { composeRun } from "./pipeline/compose.js";
import { runPipeline } from "./pipeline/run.js";
import { importVoiceProfile, listVoiceProfiles, removeVoiceProfile } from "./tts/voiceRegistry.js";
import { normalizeLanguageCode } from "./utils/lang.js";
import { openPath } from "./preview/open.js";
import type { RenderOptions } from "./manim/options.js";
import { renderManimFile } from "./manim/render.js";
import { writeJsonFile } from "./utils/fs.js";
import { getModelCachePath, getRuntimePath } from "./config/paths.js";
import { ProgressReporter } from "./ui/progress.js";
import type { Proposal } from "./workspace/schemas.js";
import { resolveRuntimeBundle } from "./runtime/manifest.js";
import { loadInstalledRuntimeState } from "./runtime/versioning.js";
import { getInstalledRuntimeRoot, loadRuntimeMetadata } from "./runtime/locator.js";

function commandOptions(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    const plain = value as Record<string, unknown>;
    if ("opts" in plain && typeof plain.opts === "function") {
      return {
        ...plain,
        ...(plain.opts() as Record<string, unknown>)
      };
    }
    return plain;
  }
  return {};
}

function wantsJson(options?: Record<string, unknown>): boolean {
  return Boolean(options?.json) || process.argv.includes("--json");
}

function addSharedRenderOptions(command: Command): Command {
  return command
    .option("-p, --preview", "Open the final rendered video after completion")
    .option("-q, --quality <quality>", "Render quality preset (l, m, h, p, k)")
    .option("--renderer <renderer>", "Manim renderer backend (cairo|opengl)")
    .option("--tts", "Enable narration generation", false)
    .option("--no-tts", "Disable narration generation")
    .option("--tts-provider <provider>", "Override TTS provider")
    .option("--voice <voice>", "Select a provider-native voice")
    .option("--voice-profile <name>", "Use an imported voice profile")
    .option("--lang <code>", "Narration language code")
    .option("--speed <speed>", "Narration speed", Number)
    .option("--subtitle-mode <mode>", "Subtitle mode (none|srt|burned)", "none")
    .option("--captions", "Enable burned-in captions", false)
    .option("--allow-cloud-tts", "Allow cloud TTS fallback", false)
    .option("--enable-voice-cloning", "Enable custom voice cloning", false)
    .option("--reference-audio <paths...>", "Reference audio for custom voice providers")
    .option("--json", "Emit JSON output", false);
}

function coerceRenderOptions(options: Record<string, unknown>): RenderOptions {
  return {
    preview: Boolean(options.preview),
    quality: typeof options.quality === "string" ? options.quality : undefined,
    renderer:
      options.renderer === "opengl" || options.renderer === "cairo"
        ? options.renderer
        : undefined,
    tts: Boolean(options.tts),
    ttsProvider: typeof options.ttsProvider === "string" ? options.ttsProvider : undefined,
    voice: typeof options.voice === "string" ? options.voice : undefined,
    voiceProfile: typeof options.voiceProfile === "string" ? options.voiceProfile : undefined,
    lang: normalizeLanguageCode(typeof options.lang === "string" ? options.lang : undefined),
    speed: typeof options.speed === "number" ? options.speed : undefined,
    subtitleMode: (options.subtitleMode as RenderOptions["subtitleMode"]) ?? "none",
    captions: Boolean(options.captions),
    allowCloudTts: Boolean(options.allowCloudTts),
    enableVoiceCloning: Boolean(options.enableVoiceCloning),
    referenceAudio: Array.isArray(options.referenceAudio) ? (options.referenceAudio as string[]) : undefined,
    json: Boolean(options.json)
  };
}

async function resolveRenderOptions(options: Record<string, unknown>): Promise<RenderOptions> {
  const config = await loadConfig();
  const parsed = coerceRenderOptions(options);
  return {
    ...parsed,
    tts: options.tts === undefined ? false : parsed.tts,
    ttsProvider: parsed.ttsProvider ?? config.defaultProvider,
    lang: parsed.lang ?? config.defaultLanguage,
    subtitleMode:
      parsed.subtitleMode && parsed.subtitleMode !== "none"
        ? parsed.subtitleMode
        : parsed.captions
          ? "burned"
          : config.defaultSubtitleMode,
    allowCloudTts: parsed.allowCloudTts || config.allowCloudTts,
    enableVoiceCloning: parsed.enableVoiceCloning || config.voiceCloningEnabled
  };
}

function humanizeSceneName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim();
}

async function buildDirectRun(
  file: string,
  scenes: string[],
  options: RenderOptions,
  reporter?: ProgressReporter
): Promise<{ runId: string; finalVideo: string }> {
  const source = await fs.readFile(path.resolve(process.cwd(), file), "utf8");
  const sceneClasses = scenes.length > 0 ? scenes : Array.from(source.matchAll(/class\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)).map((match) => match[1] ?? "").filter(Boolean);
  if (sceneClasses.length === 0) {
    throw new CliError("SCENE_MAPPING_MISSING", "No scene classes were provided or discovered in the file.");
  }

  const { runId, runPath } = await createRun(`Direct render for ${file}`, process.cwd(), { approvalRequired: false });
  const storyboard = {
    title: path.basename(file),
    audience: "general",
    style: "direct-render",
    aspectRatio: "16:9",
    scenes: sceneClasses.map((sceneClass, index) => ({
      id: `scene_${index + 1}`,
      title: humanizeSceneName(sceneClass),
      goal: `Render ${sceneClass}`,
      narrationText: humanizeSceneName(sceneClass),
      targetDurationSec: 6,
      visualBrief: `Use the ${sceneClass} animation from the source file.`,
      manimSceneClass: sceneClass,
      language: options.lang
    }))
  };
  const narration = {
    provider: options.ttsProvider,
    voice: options.voice,
    language: options.lang,
    speed: options.speed ?? 1,
    scenes: []
  };

  await writeJsonFile(path.join(runPath, "storyboard.json"), storyboard);
  await writeJsonFile(path.join(runPath, "narration.json"), narration);
  await fs.copyFile(path.resolve(process.cwd(), file), path.join(runPath, "video.py"));

  const pipelineOptions: RenderOptions = { ...options, preview: false, tts: options.tts };
  const result = await runPipeline(runId, pipelineOptions, process.cwd(), reporter);
  return { runId, finalVideo: result.finalVideo };
}

function renderProposalReview(proposal: Proposal, markdown: string, runId: string, version: number): void {
  process.stdout.write(`${markdown}\n\n`);
  process.stdout.write(`Approve with: manim-cli agent approve --run ${runId} --proposal-version ${version}\n`);
  process.stdout.write(`Request changes with: manim-cli agent reject --run ${runId} --reason "<feedback>"\n`);
  process.stdout.write(`This proposal is the source of truth for the later storyboard, narration, and code.\n`);
}

async function runDirectRender(file: string, scenes: string[], rawOptions: Record<string, unknown>): Promise<void> {
  const options = await resolveRenderOptions(rawOptions);
  const reporter = ProgressReporter.forCli(Boolean(options.json));
  if (options.tts || options.subtitleMode !== "none") {
    const result = await buildDirectRun(file, scenes, options, reporter);
    printOutput({
      status: "ok",
      stage: "completed",
      runId: result.runId,
      artifacts: { finalVideo: result.finalVideo },
      message: options.tts ? `Rendered narrated video for ${file}` : `Rendered captioned video for ${file}`
    }, options.json);
    if (options.preview) {
      await openPath(result.finalVideo);
    }
    return;
  }
  reporter.banner(`Render ${path.basename(file)}`);
  reporter.stage(1, 1, "Render");
  await renderManimFile(file, scenes, options, process.cwd(), reporter);
  reporter.status("success", `Rendered ${file}`);
  printOutput({
    status: "ok",
    stage: "render",
    message: `Rendered ${file}`
  }, options.json);
}

export async function runCli(argv: string[]): Promise<void> {
  const program = new Command();
  program
    .name("manim-cli")
    .description("Manim Community wrapper with agent workflows and multi-provider TTS")
    .showHelpAfterError();

  addSharedRenderOptions(program)
    .argument("[file]")
    .argument("[scenes...]", "Scene class names")
    .action(async (file, scenes, options) => {
      if (!file) {
        program.help();
      }
      await runDirectRender(file, scenes, options);
    });

  addSharedRenderOptions(
    program.command("render")
      .argument("<file>")
      .argument("[scenes...]", "Scene class names")
  ).action(async (file, scenes, options) => {
    await runDirectRender(file, scenes, options);
  });

  program.command("setup").option("--json", "Emit JSON", false).action(async (...args) => {
    const parsed = commandOptions(args.at(-1));
    const reporter = ProgressReporter.forCli(wantsJson(parsed));
    reporter.banner("Setup");
    reporter.stage(1, 3, "Resolve runtime bundle");
    const bundle = await resolveRuntimeBundle(pkg.version);
    reporter.stage(2, 3, "Install managed runtime");
    const runtime = await ensureManagedRuntime(reporter);
    reporter.stage(3, 3, "Run smoke test");
    await bootstrapRuntime(reporter);
    reporter.status("success", "Managed runtime bootstrapped");
    printOutput({
      status: "ok",
      stage: "setup",
      artifacts: { runtimeRoot: runtime.runtimeRoot },
      data: {
        runtimeVersion: bundle.version,
        platform: bundle.platform,
        changed: runtime.changed
      },
      message: "Managed runtime bootstrapped successfully."
    }, wantsJson(parsed));
  });

  program.command("doctor").option("--json", "Emit JSON", false).action(async (...args) => {
    const parsed = commandOptions(args.at(-1));
    const reporter = ProgressReporter.forCli(wantsJson(parsed));
    reporter.banner("Doctor");
    reporter.stage(1, 1, "Inspect environment");
    const report = await collectDoctorReport();
    reporter.status("success", "Environment inspection complete");
    printOutput({
      status: "ok",
      stage: "doctor",
      data: report,
      message: "Environment report collected."
    }, wantsJson(parsed));
  });

  const runtime = program.command("runtime");
  runtime.command("info").option("--json", "Emit JSON", false).action(async (...args) => {
    const parsed = commandOptions(args.at(-1));
    const state = await loadInstalledRuntimeState();
    let metadata: Awaited<ReturnType<typeof loadRuntimeMetadata>> | undefined;
    if (state.current?.installDir) {
      metadata = await loadRuntimeMetadata(state.current.installDir);
    }
    printOutput({
      status: "ok",
      stage: "runtime",
      data: {
        installed: Boolean(state.current),
        current: state.current,
        previous: state.previous,
        metadata
      },
      message: state.current
        ? `Managed runtime ${state.current.version} installed for ${state.current.platform}.`
        : "Managed runtime is not installed."
    }, wantsJson(parsed));
  });

  runtime.command("upgrade").option("--json", "Emit JSON", false).action(async (...args) => {
    const parsed = commandOptions(args.at(-1));
    const reporter = ProgressReporter.forCli(wantsJson(parsed));
    reporter.banner("Runtime Upgrade");
    reporter.stage(1, 3, "Resolve latest runtime");
    const bundle = await resolveRuntimeBundle(pkg.version);
    reporter.stage(2, 3, "Install runtime");
    const runtime = await ensureManagedRuntime(reporter);
    reporter.stage(3, 3, "Validate runtime");
    await bootstrapRuntime(reporter);
    reporter.status("success", runtime.changed ? `Runtime ${bundle.version} ready` : `Runtime ${bundle.version} already current`);
    printOutput({
      status: "ok",
      stage: "runtime",
      artifacts: { runtimeRoot: runtime.runtimeRoot },
      data: {
        runtimeVersion: bundle.version,
        platform: bundle.platform,
        changed: runtime.changed
      },
      message: runtime.changed
        ? `Managed runtime ${bundle.version} is ready.`
        : `Managed runtime ${bundle.version} is already current.`
    }, wantsJson(parsed));
  });

  runtime.command("repair").option("--json", "Emit JSON", false).action(async (...args) => {
    const parsed = commandOptions(args.at(-1));
    const reporter = ProgressReporter.forCli(wantsJson(parsed));
    reporter.banner("Runtime Repair");
    reporter.stage(1, 2, "Reinstall runtime");
    const runtime = await repairRuntime(reporter);
    reporter.stage(2, 2, "Inspect repaired runtime");
    reporter.status("success", "Managed runtime repaired");
    printOutput({
      status: "ok",
      stage: "runtime",
      artifacts: { runtimeRoot: runtime.runtimeRoot },
      data: { runtimeVersion: runtime.version },
      message: "Managed runtime repaired successfully."
    }, wantsJson(parsed));
  });

  const config = program.command("config");
  config.command("get").argument("<key>").action(async (key: string) => {
    const value = (await loadConfig())[key as keyof Awaited<ReturnType<typeof loadConfig>>];
    process.stdout.write(`${JSON.stringify(value)}\n`);
  });
  config.command("set").argument("<key>").argument("<value>").action(async (key: string, value: string) => {
    const parsed: unknown = value === "true" ? true : value === "false" ? false : value;
    const updated = await setConfigValue(key as never, parsed);
    process.stdout.write(`${JSON.stringify(updated, null, 2)}\n`);
  });

  const auth = program.command("auth");
  const openaiAuth = auth.command("openai");
  openaiAuth.command("login").option("--api-key <key>").action(async (...args) => {
    const parsed = commandOptions(args.at(-1));
    const apiKey = typeof parsed.apiKey === "string" ? parsed.apiKey : await promptHidden("OpenAI API key: ");
    await setSecret("openai_api_key", apiKey);
    process.stdout.write("OpenAI API key stored.\n");
  });
  openaiAuth.command("logout").action(async () => {
    await deleteSecret("openai_api_key");
    process.stdout.write("OpenAI API key removed.\n");
  });

  const voice = program.command("voice");
  voice.command("import")
    .argument("<name>")
    .requiredOption("--samples <paths...>", "Reference audio samples")
    .requiredOption("--lang <code>", "Voice language")
    .requiredOption("--consent-file <path>", "Consent file path")
    .option("--enable-cloning", "Explicit opt-in for voice cloning")
    .action(async (name, ...args) => {
      const parsed = commandOptions(args.at(-1));
      if (!parsed.enableCloning) {
        throw new CliError("VOICE_CLONING_DISABLED", "voice import requires --enable-cloning.");
      }
      await importVoiceProfile({
        name,
        language: normalizeLanguageCode(parsed.lang as string),
        samples: parsed.samples as string[],
        consentFile: parsed.consentFile as string,
        importedAt: new Date().toISOString()
      });
      process.stdout.write(`Imported voice profile ${name}.\n`);
    });
  voice.command("list").action(async () => {
    process.stdout.write(`${JSON.stringify(await listVoiceProfiles(), null, 2)}\n`);
  });
  voice.command("remove").argument("<name>").action(async (name) => {
    await removeVoiceProfile(name);
    process.stdout.write(`Removed voice profile ${name}.\n`);
  });

  program.command("clean-cache").action(async () => {
    await fs.rm(path.join(process.cwd(), ".manim-cli"), { force: true, recursive: true });
    await fs.rm(getRuntimePath(), { force: true, recursive: true });
    await fs.rm(getModelCachePath(), { force: true, recursive: true });
    process.stdout.write("Workspace and runtime caches removed.\n");
  });

  const agent = program.command("agent");
  agent.command("init")
    .requiredOption("--prompt <prompt>", "Prompt used to create the video")
    .option("--json", "Emit JSON", false)
    .action(async (...args) => {
      const parsed = commandOptions(args.at(-1));
      const { runId, runPath } = await createRun(parsed.prompt as string, process.cwd());
      printOutput({
        status: "ok",
        stage: "init",
        runId,
        artifacts: { runPath },
        nextActions: ["manim-cli agent propose --run <runId>"]
      }, wantsJson(parsed));
    });

  agent.command("propose")
    .requiredOption("--run <runId>", "Run identifier")
    .option("--json", "Emit JSON", false)
    .action(async (...args) => {
      const parsed = commandOptions(args.at(-1));
      const runId = parsed.run as string;
      const manifest = await loadManifest(runId, process.cwd());
      const config = await loadConfig();
      const nextVersion = manifest.proposalVersion + 1;
      const proposal = createProposal(manifest.prompt, config.defaultLanguage);
      const markdown = renderProposalMarkdown(proposal, nextVersion);
      await writeProposalFiles(runId, proposal, markdown, process.cwd());
      manifest.stage = "proposal";
      manifest.proposalVersion = nextVersion;
      manifest.proposalStatus = "pending";
      manifest.approvedProposalVersion = undefined;
      manifest.approvedAt = undefined;
      manifest.rejectionReason = undefined;
      await saveManifest(runId, manifest, process.cwd());
      await appendStageHistory(runId, "proposal", "completed", {
        proposalVersion: nextVersion,
        supersededProposalVersion: nextVersion > 1 ? nextVersion - 1 : undefined
      }, process.cwd());
      const proposalPath = path.join(getRunPath(runId), "proposal.json");
      const proposalMarkdownPath = path.join(getRunPath(runId), "proposal.md");
      if (wantsJson(parsed)) {
        printOutput({
          status: "ok",
          stage: "proposal",
          runId,
          artifacts: { proposalPath, proposalMarkdownPath },
          data: {
            proposalVersion: nextVersion,
            approvalStatus: "pending"
          },
          nextActions: [
            `manim-cli agent approve --run ${runId} --proposal-version ${nextVersion}`,
            `manim-cli agent reject --run ${runId} --reason "<feedback>"`
          ]
        }, true);
        return;
      }
      renderProposalReview(proposal, markdown, runId, nextVersion);
    });

  agent.command("approve")
    .requiredOption("--run <runId>", "Run identifier")
    .option("--proposal-version <version>", "Proposal version to approve", Number)
    .option("--json", "Emit JSON", false)
    .action(async (...args) => {
      const parsed = commandOptions(args.at(-1));
      const runId = parsed.run as string;
      const manifest = await loadManifest(runId, process.cwd());
      await loadProposal(runId, process.cwd());
      const expectedVersion = typeof parsed.proposalVersion === "number" ? parsed.proposalVersion : manifest.proposalVersion;
      if (expectedVersion !== manifest.proposalVersion) {
        throw new CliError("PROPOSAL_VERSION_CONFLICT", `Proposal version ${expectedVersion} does not match current version ${manifest.proposalVersion}.`, {
          proposalVersion: manifest.proposalVersion,
          requestedVersion: expectedVersion
        });
      }
      manifest.proposalStatus = "approved";
      manifest.approvedProposalVersion = manifest.proposalVersion;
      manifest.approvedAt = new Date().toISOString();
      manifest.rejectionReason = undefined;
      await saveManifest(runId, manifest, process.cwd());
      await appendStageHistory(runId, "proposal", "completed", {
        proposalVersion: manifest.proposalVersion,
        approvalStatus: "approved"
      }, process.cwd());
      printOutput({
        status: "ok",
        stage: "proposal",
        runId,
        data: {
          proposalVersion: manifest.proposalVersion,
          approvalStatus: manifest.proposalStatus
        },
        nextActions: [`manim-cli agent scaffold --run ${runId}`]
      }, wantsJson(parsed));
    });

  agent.command("reject")
    .requiredOption("--run <runId>", "Run identifier")
    .requiredOption("--reason <reason>", "Reason the proposal needs changes")
    .option("--json", "Emit JSON", false)
    .action(async (...args) => {
      const parsed = commandOptions(args.at(-1));
      const runId = parsed.run as string;
      const manifest = await loadManifest(runId, process.cwd());
      await loadProposal(runId, process.cwd());
      manifest.proposalStatus = "rejected";
      manifest.rejectionReason = parsed.reason as string;
      manifest.approvedProposalVersion = undefined;
      manifest.approvedAt = undefined;
      await saveManifest(runId, manifest, process.cwd());
      await appendStageHistory(runId, "proposal", "completed", {
        proposalVersion: manifest.proposalVersion,
        approvalStatus: "rejected",
        rejectionReason: manifest.rejectionReason
      }, process.cwd());
      printOutput({
        status: "ok",
        stage: "proposal",
        runId,
        data: {
          proposalVersion: manifest.proposalVersion,
          approvalStatus: manifest.proposalStatus
        },
        nextActions: [`manim-cli agent propose --run ${runId}`]
      }, wantsJson(parsed));
    });

  agent.command("scaffold")
    .requiredOption("--run <runId>", "Run identifier")
    .option("--json", "Emit JSON", false)
    .action(async (...args) => {
      const parsed = commandOptions(args.at(-1));
      const runId = parsed.run as string;
      await ensureProposalApproved(runId, process.cwd());
      const proposal = await loadProposal(runId, process.cwd());
      const config = await loadConfig();
      const scaffold = createScaffoldFromProposal(proposal, {
        language: config.defaultLanguage,
        provider: config.defaultProvider
      });
      await writeScaffoldFiles(runId, scaffold.storyboard, scaffold.narration, scaffold.pythonSource, process.cwd());
      await appendStageHistory(runId, "scaffold", "completed", {
        sceneCount: scaffold.storyboard.scenes.length
      }, process.cwd());
      printOutput({
        status: "ok",
        stage: "scaffold",
        runId,
        artifacts: { runPath: getRunPath(runId) }
      }, wantsJson(parsed));
    });

  agent.command("validate")
    .requiredOption("--run <runId>", "Run identifier")
    .option("--json", "Emit JSON", false)
    .action(async (...args) => {
      const parsed = commandOptions(args.at(-1));
      const reporter = ProgressReporter.forCli(wantsJson(parsed));
      const runId = parsed.run as string;
      reporter.banner(`Validate ${runId}`);
      reporter.stage(1, 1, "Validate");
      const result = await validateRun(runId, process.cwd());
      await appendStageHistory(runId, "validate", "completed", result, process.cwd());
      reporter.status("success", "Validation complete");
      for (const warning of result.warnings) {
        reporter.status("warning", warning);
      }
      printOutput({
        status: "ok",
        stage: "validate",
        runId,
        data: result
      }, wantsJson(parsed));
    });

  addSharedRenderOptions(agent.command("render").requiredOption("--run <runId>", "Run identifier"))
    .action(async (...args) => {
      const parsed = commandOptions(args.at(-1));
      const renderOptions = await resolveRenderOptions(parsed);
      const reporter = ProgressReporter.forCli(Boolean(renderOptions.json));
      const runId = parsed.run as string;
      await ensureProposalApproved(runId, process.cwd());
      reporter.banner(`Render ${runId}`);
      reporter.stage(1, 1, "Render");
      const renderOutputs = await renderRun(runId, renderOptions, process.cwd(), reporter);
      await appendStageHistory(runId, "render", "completed", { renderOutputs }, process.cwd());
      reporter.status("success", "Render complete");
      printOutput({
        status: "ok",
        stage: "render",
        runId,
        data: { renderOutputs }
      }, renderOptions.json);
    });

  addSharedRenderOptions(agent.command("tts").requiredOption("--run <runId>", "Run identifier"))
    .action(async (...args) => {
      const parsed = commandOptions(args.at(-1));
      const renderOptions = await resolveRenderOptions(parsed);
      const reporter = ProgressReporter.forCli(Boolean(renderOptions.json));
      const runId = parsed.run as string;
      await ensureProposalApproved(runId, process.cwd());
      reporter.banner(`Narration ${runId}`);
      reporter.stage(1, 1, "Synthesize");
      const audioFiles = await synthesizeRun(runId, { ...renderOptions, tts: true }, process.cwd(), reporter);
      await appendStageHistory(runId, "tts", "completed", { audioFiles }, process.cwd());
      reporter.status("success", "Narration complete");
      printOutput({
        status: "ok",
        stage: "tts",
        runId,
        artifacts: { audioFiles }
      }, renderOptions.json);
    });

  addSharedRenderOptions(agent.command("compose").requiredOption("--run <runId>", "Run identifier"))
    .action(async (...args) => {
      const parsed = commandOptions(args.at(-1));
      const renderOptions = await resolveRenderOptions(parsed);
      const reporter = ProgressReporter.forCli(Boolean(renderOptions.json));
      const runId = parsed.run as string;
      await ensureProposalApproved(runId, process.cwd());
      reporter.banner(`Compose ${runId}`);
      reporter.stage(1, 1, "Compose");
      const finalVideo = await composeRun(runId, renderOptions.subtitleMode, process.cwd(), reporter);
      await appendStageHistory(runId, "compose", "completed", { finalVideo }, process.cwd());
      reporter.status("success", `Output ready: ${finalVideo}`);
      printOutput({
        status: "ok",
        stage: "compose",
        runId,
        artifacts: { finalVideo }
      }, renderOptions.json);
      if (renderOptions.preview) {
        await openPath(finalVideo);
      }
    });

  addSharedRenderOptions(agent.command("run").requiredOption("--run <runId>", "Run identifier"))
    .action(async (...args) => {
      const parsed = commandOptions(args.at(-1));
      const renderOptions = await resolveRenderOptions(parsed);
      const reporter = ProgressReporter.forCli(Boolean(renderOptions.json));
      const runId = parsed.run as string;
      await ensureProposalApproved(runId, process.cwd());
      const { finalVideo } = await runPipeline(runId, renderOptions, process.cwd(), reporter);
      printOutput({
        status: "ok",
        stage: "completed",
        runId,
        artifacts: { finalVideo }
      }, renderOptions.json);
      if (renderOptions.preview) {
        await openPath(finalVideo);
      }
    });

  addSharedRenderOptions(agent.command("resume").requiredOption("--run <runId>", "Run identifier"))
    .action(async (...args) => {
      const parsed = commandOptions(args.at(-1));
      const renderOptions = await resolveRenderOptions(parsed);
      const reporter = ProgressReporter.forCli(Boolean(renderOptions.json));
      const runId = parsed.run as string;
      await ensureProposalApproved(runId, process.cwd());
      const manifest = await loadManifest(runId, process.cwd());
      const completedStages = new Set(
        manifest.stageHistory.filter((entry) => entry.status === "completed").map((entry) => entry.stage)
      );
      if (!completedStages.has("validate")) {
        reporter.stage(1, 4, "Validate");
        await validateRun(runId, process.cwd());
      }
      if (!completedStages.has("render")) {
        reporter.stage(2, 4, "Render");
        await renderRun(runId, renderOptions, process.cwd(), reporter);
      }
      if (renderOptions.tts && !completedStages.has("tts")) {
        reporter.stage(3, 4, "Narration");
        await synthesizeRun(runId, renderOptions, process.cwd(), reporter);
      }
      let finalVideo: string;
      if (renderOptions.tts || renderOptions.subtitleMode !== "none") {
        reporter.stage(4, 4, "Compose");
        finalVideo = await composeRun(runId, renderOptions.subtitleMode, process.cwd(), reporter);
      } else {
        const renderRecord = manifest.stageHistory.find((entry) => entry.stage === "render" && entry.status === "completed");
        const renderOutputs = (renderRecord?.details?.renderOutputs as Record<string, string> | undefined) ?? {};
        finalVideo = Object.values(renderOutputs)[0] ?? "";
        if (!finalVideo) {
          throw new CliError("COMPOSE_FAILED", "No rendered video artifact was found for resume.");
        }
      }
      reporter.status("success", `Output ready: ${finalVideo}`);
      printOutput({
        status: "ok",
        stage: "completed",
        runId,
        artifacts: { finalVideo }
      }, renderOptions.json);
    });

  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof CliError) {
      printOutput({
        status: "error",
        message: error.message,
        errors: [{ code: error.code, details: error.details }]
      }, argv.includes("--json"));
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}
