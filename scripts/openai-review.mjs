#!/usr/bin/env node
import fs from "node:fs/promises";
import process from "node:process";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const mode = arg("--mode");
const inputFile = arg("--input-file");
const outputFile = arg("--output-file");

if (!mode || !inputFile || !outputFile) {
  process.stderr.write("Usage: node scripts/openai-review.mjs --mode <pr-review|failure-review> --input-file <path> --output-file <path>\n");
  process.exit(1);
}

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  process.stderr.write("OPENAI_API_KEY is required.\n");
  process.exit(1);
}

const model = process.env.OPENAI_REVIEW_MODEL || "gpt-5-codex";
const inputText = await fs.readFile(inputFile, "utf8");

function buildPrompt() {
  if (mode === "pr-review") {
    return [
      "You are reviewing a GitHub pull request for a production npm package that wraps Manim Community and a managed runtime.",
      `Repository: ${process.env.GITHUB_REPOSITORY ?? "unknown"}`,
      `PR number: ${process.env.GITHUB_PR_NUMBER ?? "unknown"}`,
      `Base branch: ${process.env.GITHUB_BASE_REF ?? "unknown"}`,
      `Head branch: ${process.env.GITHUB_HEAD_REF ?? "unknown"}`,
      "",
      "Review the diff for bugs, regressions, behavior changes, release workflow risks, packaging mistakes, and missing tests.",
      "Ignore style-only issues.",
      "Return concise markdown with this shape:",
      "## OpenAI PR Review",
      "- Overall risk: low|medium|high",
      "- Findings: bullet list with file paths and concrete risks",
      "- Missing tests: bullet list or `None`",
      "- Recommended next step: one short paragraph",
      "",
      "If there are no meaningful findings, say so explicitly.",
      "",
      "Diff:",
      inputText
    ].join("\n");
  }

  return [
    "You are analyzing a failed GitHub Actions workflow for a production npm package that wraps Manim Community and a managed runtime.",
    `Repository: ${process.env.GITHUB_REPOSITORY ?? "unknown"}`,
    `Workflow: ${process.env.GITHUB_WORKFLOW_NAME ?? "unknown"}`,
    `Run number: ${process.env.GITHUB_RUN_NUMBER ?? "unknown"}`,
    `Run URL: ${process.env.GITHUB_RUN_URL ?? "unknown"}`,
    `Event: ${process.env.GITHUB_EVENT_NAME ?? "unknown"}`,
    `Branch: ${process.env.GITHUB_HEAD_BRANCH ?? "unknown"}`,
    `Commit: ${process.env.GITHUB_HEAD_SHA ?? "unknown"}`,
    "",
    "Analyze the failure log and produce concise markdown with this shape:",
    "## OpenAI Failure Review",
    "- Likely root cause: one bullet",
    "- Evidence: 1-3 bullets quoting or paraphrasing specific log clues",
    "- Fix plan: 1-3 bullets",
    "- Suggested owner action: one short paragraph",
    "",
    "Be concrete. Do not invent facts not supported by the log.",
    "",
    "Failed log excerpt:",
    inputText
  ].join("\n");
}

function extractOutputText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const outputs = [];
  for (const item of response?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (content?.type === "output_text" && typeof content?.text === "string") {
        outputs.push(content.text);
      }
    }
  }
  return outputs.join("\n").trim();
}

const response = await fetch("https://api.openai.com/v1/responses", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model,
    input: buildPrompt(),
    reasoning: {
      effort: "medium"
    }
  })
});

if (!response.ok) {
  const body = await response.text();
  process.stderr.write(`OpenAI request failed: ${response.status} ${response.statusText}\n${body}\n`);
  process.exit(1);
}

const data = await response.json();
const text = extractOutputText(data);
if (!text) {
  process.stderr.write("OpenAI response did not contain output text.\n");
  process.exit(1);
}

await fs.writeFile(outputFile, `${text}\n`, "utf8");
