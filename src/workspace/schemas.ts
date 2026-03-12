import { z } from "zod";

export const sceneSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  goal: z.string().min(1),
  narrationText: z.string().min(1),
  targetDurationSec: z.number().positive(),
  visualBrief: z.string().min(1),
  manimSceneClass: z.string().min(1),
  language: z.string().optional(),
  provider: z.string().optional()
});

export const proposalSectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  purpose: z.string().min(1),
  conceptsCovered: z.array(z.string().min(1)).min(1),
  targetDurationSec: z.number().positive(),
  visualPlan: z.string().min(1),
  narrationSummary: z.string().min(1),
  prerequisites: z.array(z.string().min(1)).default([]),
  qualityChecks: z.array(z.string().min(1)).min(1)
});

export const proposalSchema = z.object({
  title: z.string().min(1),
  audience: z.string().min(1),
  learningGoal: z.string().min(1),
  estimatedDurationSec: z.number().positive(),
  difficulty: z.enum(["beginner", "intermediate", "advanced"]),
  sections: z.array(proposalSectionSchema).min(1)
});

export const storyboardSchema = z.object({
  title: z.string().min(1),
  audience: z.string().min(1),
  style: z.string().min(1),
  aspectRatio: z.string().min(1),
  scenes: z.array(sceneSchema).min(1)
});

export const narrationSchema = z.object({
  provider: z.string().optional(),
  voice: z.string().optional(),
  language: z.string().optional(),
  speed: z.number().positive().default(1),
  scenes: z.array(
    z.object({
      id: z.string(),
      voice: z.string().optional(),
      voiceProfile: z.string().optional(),
      language: z.string().optional(),
      provider: z.string().optional()
    })
  ).default([])
});

export const manifestSchema = z.object({
  runId: z.string(),
  createdAt: z.string(),
  prompt: z.string(),
  stage: z.enum(["init", "proposal", "scaffold", "validate", "render", "tts", "compose", "completed"]),
  stageHistory: z.array(
    z.object({
      stage: z.string(),
      status: z.enum(["started", "completed", "failed"]),
      timestamp: z.string(),
      details: z.record(z.unknown()).optional()
    })
  ),
  artifacts: z.record(z.string()),
  routingDecisions: z.array(z.record(z.unknown())).default([]),
  approvalRequired: z.boolean().default(true),
  proposalStatus: z.enum(["pending", "approved", "rejected", "superseded"]).default("pending"),
  proposalVersion: z.number().int().nonnegative().default(0),
  approvedProposalVersion: z.number().int().nonnegative().optional(),
  approvedAt: z.string().optional(),
  rejectionReason: z.string().optional(),
  errors: z.array(
    z.object({
      code: z.string(),
      message: z.string(),
      timestamp: z.string()
    })
  ).default([])
});

export type Storyboard = z.infer<typeof storyboardSchema>;
export type NarrationConfig = z.infer<typeof narrationSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
export type Proposal = z.infer<typeof proposalSchema>;
export type ProposalSection = z.infer<typeof proposalSectionSchema>;
