import { describe, expect, test } from "vitest";
import { createProposal, createScaffoldFromProposal, renderProposalMarkdown } from "../src/templates.js";

describe("proposal scaffold generation", () => {
  test("creates an educational proposal and scaffold from it", () => {
    const proposal = createProposal("Explain eigenvectors");
    const scaffold = createScaffoldFromProposal(proposal, { language: "en-US" });

    expect(proposal.sections).toHaveLength(5);
    expect(proposal.sections[4]?.title).toContain("Recap");
    expect(scaffold.storyboard.scenes).toHaveLength(proposal.sections.length);
    expect(scaffold.storyboard.scenes[0]?.id).toBe(proposal.sections[0]?.id);
    expect(scaffold.narration.provider).toBe("kokoro-82m");
    expect(scaffold.pythonSource).toContain("class WhyThisTopicMattersScene");
  });

  test("renders proposal markdown for review", () => {
    const proposal = createProposal("Explain eigenvectors");
    const markdown = renderProposalMarkdown(proposal, 2);
    expect(markdown).toContain("# Explain eigenvectors");
    expect(markdown).toContain("Version: 2");
    expect(markdown).toContain("## Table of Contents");
  });
});
