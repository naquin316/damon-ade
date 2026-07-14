import { z } from "zod";

export const nodeStatus = z.enum(["pending", "running", "done", "failed", "skipped"]);
export type NodeStatus = z.infer<typeof nodeStatus>;

export const runStatus = z.enum([
	// "failed" covers a run that never made it out of planning (Conductor
	// timeout or a cyclic plan) — distinct from "partial", which the engine
	// uses for a run that got dispatched but had at least one node fail.
	"planning", "awaiting-approval", "running", "done", "partial", "cancelled", "failed",
]);
export type RunStatus = z.infer<typeof runStatus>;

export const capabilityManifestSchema = z.object({
	team: z.string(),
	agent: z.string(), // seed-brain slug == handoff recipient-slug
	handles: z.array(z.string()),
	needs: z.array(z.string()).default([]),
	emits: z.array(z.string()).default([]),
	gate: z.string().optional(),
});
export type CapabilityManifest = z.infer<typeof capabilityManifestSchema>;
export type Roster = CapabilityManifest[];

export const runNodeSchema = z.object({
	id: z.string(),
	agent: z.string(),
	task: z.string(),
	needs: z.array(z.string()).default([]),
	status: nodeStatus.default("pending"),
	handoff_id: z.string().nullable().default(null),
	result: z.string().nullable().default(null),
});
export type RunNode = z.infer<typeof runNodeSchema>;

export const runManifestSchema = z.object({
	run_id: z.string(),
	goal: z.string(),
	status: runStatus,
	created: z.string(),
	nodes: z.array(runNodeSchema),
	summary: z.string().nullable().default(null),
});
export type RunManifest = z.infer<typeof runManifestSchema>;

export type OrchestratorEvent =
	| { type: "run-updated"; run: RunManifest }
	| { type: "run-error"; runId: string; message: string };
