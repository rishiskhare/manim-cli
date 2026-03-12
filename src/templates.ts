import type { NarrationConfig, Proposal, ProposalSection, Storyboard } from "./workspace/schemas.js";
import { normalizeLanguageCode } from "./utils/lang.js";

type ProposalScaffold = {
  proposal: Proposal;
  storyboard: Storyboard;
  narration: NarrationConfig;
  pythonSource: string;
};

function inferDifficulty(prompt: string): Proposal["difficulty"] {
  const normalized = prompt.toLowerCase();
  if (/(advanced|rigorous|formal|proof|graduate|expert)/.test(normalized)) {
    return "advanced";
  }
  if (/(intermediate|practical|implementation|systems|engineer)/.test(normalized)) {
    return "intermediate";
  }
  return "beginner";
}

function inferAudience(difficulty: Proposal["difficulty"]): string {
  if (difficulty === "advanced") {
    return "advanced learners";
  }
  if (difficulty === "intermediate") {
    return "practicing engineers";
  }
  return "curious beginners";
}

function durationForDifficulty(difficulty: Proposal["difficulty"]): number[] {
  if (difficulty === "advanced") {
    return [12, 16, 18, 16, 10];
  }
  if (difficulty === "intermediate") {
    return [10, 14, 16, 14, 8];
  }
  return [8, 12, 14, 12, 8];
}

function toSceneClass(section: ProposalSection, index: number): string {
  const sanitized = section.title.replace(/[^A-Za-z0-9]+/g, " ").trim();
  const parts = sanitized.split(/\s+/).filter(Boolean);
  const pascal = parts.map((part) => part[0]!.toUpperCase() + part.slice(1).toLowerCase()).join("");
  return pascal ? `${pascal}Scene` : `Section${index + 1}Scene`;
}

export function createProposal(prompt: string, language = "en-US"): Proposal {
  const difficulty = inferDifficulty(prompt);
  const audience = inferAudience(difficulty);
  const durations = durationForDifficulty(difficulty);
  const normalizedLanguage = normalizeLanguageCode(language);
  const topic = prompt.trim();
  const sections: ProposalSection[] = [
    {
      id: "section_1",
      title: "Why This Topic Matters",
      purpose: `Frame ${topic} with the problem it solves and the intuition the viewer needs before details.`,
      conceptsCovered: [topic, "motivation", "big picture"],
      targetDurationSec: durations[0],
      visualPlan: "Open with a title card, then reveal a simple motivating diagram or comparison.",
      narrationSummary: `Introduce ${topic}, explain why it matters, and set up the core question the rest of the video will answer.`,
      prerequisites: [],
      qualityChecks: ["Defines the goal in plain language", "Establishes why the viewer should care"]
    },
    {
      id: "section_2",
      title: "Core Intuition",
      purpose: `Build an intuitive mental model for ${topic} before formal mechanics appear.`,
      conceptsCovered: [topic, "intuition", "mental model"],
      targetDurationSec: durations[1],
      visualPlan: "Use one central visual metaphor with progressive reveals rather than multiple disconnected diagrams.",
      narrationSummary: `Explain the central intuition behind ${topic} using plain language and one memorable visual anchor.`,
      prerequisites: ["section_1"],
      qualityChecks: ["Uses beginner-friendly language", "Introduces only one major new idea at a time"]
    },
    {
      id: "section_3",
      title: "How It Works",
      purpose: `Walk through the main mechanism or structure behind ${topic} in an ordered, easy-to-follow way.`,
      conceptsCovered: [topic, "mechanism", "step-by-step explanation"],
      targetDurationSec: durations[2],
      visualPlan: "Animate the workflow step by step with labels that persist long enough to be read comfortably.",
      narrationSummary: `Break ${topic} into a few concrete steps and show how each step connects to the next.`,
      prerequisites: ["section_2"],
      qualityChecks: ["Steps are presented in prerequisite order", "Transitions explicitly connect ideas"]
    },
    {
      id: "section_4",
      title: "Concrete Example",
      purpose: `Make ${topic} tangible with one worked example that uses the same language as the earlier explanation.`,
      conceptsCovered: [topic, "worked example", "application"],
      targetDurationSec: durations[3],
      visualPlan: "Show a single example end to end with highlights, annotations, and intermediate states.",
      narrationSummary: `Apply ${topic} to one concrete example and point out how the earlier intuition shows up in practice.`,
      prerequisites: ["section_3"],
      qualityChecks: ["Includes at least one concrete example", "Example terminology matches prior sections"]
    },
    {
      id: "section_5",
      title: "Recap and Takeaway",
      purpose: `Summarize the essential ideas of ${topic} and leave the viewer with a concise takeaway.`,
      conceptsCovered: [topic, "summary", "takeaway"],
      targetDurationSec: durations[4],
      visualPlan: "Return to the original motivating picture and annotate it with the final understanding.",
      narrationSummary: `Recap the main ideas of ${topic}, restate the big takeaway, and suggest the next concept to learn.`,
      prerequisites: ["section_4"],
      qualityChecks: ["Ends with a concise summary", "Reinforces the key intuition without introducing new ideas"]
    }
  ];

  return {
    title: topic,
    audience,
    learningGoal: `Help the viewer understand ${topic} clearly enough to explain the main idea in their own words.`,
    estimatedDurationSec: sections.reduce((total, section) => total + section.targetDurationSec, 0),
    difficulty,
    sections: sections.map((section) => ({
      ...section,
      conceptsCovered: [...section.conceptsCovered, normalizedLanguage === "en-US" ? "clear explanation" : `localized for ${normalizedLanguage}`]
    }))
  };
}

export function createScaffoldFromProposal(
  proposal: Proposal,
  options: {
    language?: string;
    provider?: string;
    voice?: string;
    speed?: number;
  } = {}
): Omit<ProposalScaffold, "proposal"> {
  const language = normalizeLanguageCode(options.language ?? "en-US");
  const storyboard: Storyboard = {
    title: proposal.title,
    audience: proposal.audience,
    style: "educational",
    aspectRatio: "16:9",
    scenes: proposal.sections.map((section, index) => ({
      id: section.id,
      title: section.title,
      goal: section.purpose,
      narrationText: section.narrationSummary,
      targetDurationSec: section.targetDurationSec,
      visualBrief: section.visualPlan,
      manimSceneClass: toSceneClass(section, index),
      language
    }))
  };

  const narration: NarrationConfig = {
    provider: options.provider ?? "kokoro-82m",
    voice: options.voice ?? "af_heart",
    language,
    speed: options.speed ?? 1,
    scenes: proposal.sections.map((section) => ({
      id: section.id,
      language
    }))
  };

  const classes = proposal.sections
    .map((section, index) => {
      const className = storyboard.scenes[index]!.manimSceneClass;
      return `class ${className}(Scene):
    def construct(self):
        # Purpose: ${section.purpose}
        # Visual plan: ${section.visualPlan}
        title = Text(${JSON.stringify(section.title)}).scale(0.9)
        summary = Paragraph(${JSON.stringify(section.narrationSummary)}).scale(0.45).next_to(title, DOWN)
        self.play(FadeIn(title, shift=UP * 0.2))
        self.play(Write(summary))
        self.wait(2)
`;
    })
    .join("\n\n");

  const pythonSource = `from manim import *

${classes}
`;

  return { storyboard, narration, pythonSource };
}

export function createProposalScaffold(
  prompt: string,
  options: {
    language?: string;
    provider?: string;
    voice?: string;
    speed?: number;
  } = {}
): ProposalScaffold {
  const proposal = createProposal(prompt, options.language);
  return {
    proposal,
    ...createScaffoldFromProposal(proposal, options)
  };
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  if (seconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${seconds}s`;
}

export function renderProposalMarkdown(proposal: Proposal, version: number): string {
  const toc = proposal.sections.map((section, index) => `${index + 1}. ${section.title}`).join("\n");
  const details = proposal.sections.map((section, index) => {
    const learns = section.conceptsCovered.join(", ");
    return [
      `## ${index + 1}. ${section.title}`,
      `- Purpose: ${section.purpose}`,
      `- Timing: ${formatDuration(section.targetDurationSec)}`,
      `- Viewer learns: ${learns}`,
      `- Visuals: ${section.visualPlan}`
    ].join("\n");
  }).join("\n\n");

  return [
    `# ${proposal.title}`,
    ``,
    `Version: ${version}`,
    `Audience: ${proposal.audience}`,
    `Estimated Duration: ${formatDuration(proposal.estimatedDurationSec)}`,
    `Difficulty: ${proposal.difficulty}`,
    ``,
    `Summary: ${proposal.learningGoal}`,
    ``,
    `## Table of Contents`,
    toc,
    ``,
    details
  ].join("\n");
}
