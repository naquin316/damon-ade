import { expect, test } from "bun:test";
import { dispatchAgent } from "./dispatch";

test("dispatchAgent resolves slug, appends instruction, and spawns", () => {
	const spawned: string[] = [];
	const res = dispatchAgent(
		{
			resolveSlug: (s) => (s === "foreman" ? "agent-123" : null),
			spawn: ({ command }) => spawned.push(command),
			buildCommand: (id) => `claude --agent ${id}`,
		},
		"foreman",
		"Process your inbox for run r1 now.",
	);
	expect(res).toEqual({ ok: true });
	expect(spawned[0]).toContain("claude --agent agent-123");
	expect(spawned[0]).toContain("Process your inbox for run r1 now.");
});

test("dispatchAgent returns an error when the slug is unknown", () => {
	const res = dispatchAgent(
		{ resolveSlug: () => null, spawn: () => {}, buildCommand: () => "" },
		"ghost",
		"x",
	);
	expect(res).toEqual({ ok: false, error: "No agent registered for slug: ghost" });
});
