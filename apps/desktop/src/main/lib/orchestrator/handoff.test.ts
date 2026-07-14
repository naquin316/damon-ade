import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearDispatchNote, writeDispatchNote, readHandoffStatus } from "./handoff";
import { handoffInbox } from "./paths";

test("writeDispatchNote creates a pending note carrying run_id", () => {
	const vault = mkdtempSync(join(tmpdir(), "hq-"));
	writeDispatchNote(vault, { slug: "foreman", handoffId: "h1", runId: "r1", task: "mockups", facts: "FD sale" });
	const s = readHandoffStatus(vault, "foreman", "h1");
	expect(s).toEqual({ status: "pending", result: null });
});

test("writeDispatchNote renders upstream results into a ## Facts block the agent can read", () => {
	// The last link of the result-passing chain: the engine hands upstream
	// done-nodes to `dispatch`, the router renders them, and `facts` must land
	// in the note BODY -- that block is the only thing the downstream agent
	// actually reads as its input.
	const vault = mkdtempSync(join(tmpdir(), "hq-"));
	const facts = "### From strategist (n12)\nPLAN: 3 posts, Father's Day angle";
	writeDispatchNote(vault, { slug: "repurposer", handoffId: "h9", runId: "r1", task: "draft the posts", facts });
	const note = readFileSync(join(handoffInbox(vault, "repurposer"), "h9.md"), "utf8");
	expect(note).toContain("## Task\ndraft the posts");
	expect(note).toContain("## Facts");
	expect(note).toContain("### From strategist (n12)");
	expect(note).toContain("PLAN: 3 posts, Father's Day angle");
});

test("writeDispatchNote omits the ## Facts block entirely for a root node", () => {
	const vault = mkdtempSync(join(tmpdir(), "hq-"));
	writeDispatchNote(vault, { slug: "strategist", handoffId: "h10", runId: "r1", task: "write the plan" });
	const note = readFileSync(join(handoffInbox(vault, "strategist"), "h10.md"), "utf8");
	expect(note).toContain("## Task\nwrite the plan");
	expect(note).not.toContain("## Facts");
});

test("readHandoffStatus reads result from a done note and is back-compat", () => {
	const vault = mkdtempSync(join(tmpdir(), "hq-"));
	const inbox = handoffInbox(vault, "foreman");
	mkdirSync(inbox, { recursive: true });
	// A note written by an agent, flipped to done, with a result:
	writeFileSync(join(inbox, "h2.md"), "---\nhandoff_id: h2\nstatus: done\nresult: vault/x.png\n---\nbody\n", "utf8");
	expect(readHandoffStatus(vault, "foreman", "h2")).toEqual({ status: "done", result: "vault/x.png" });
	// A legacy note with no run_id/result still parses:
	writeFileSync(join(inbox, "h3.md"), "---\nhandoff_id: h3\nstatus: drafted\n---\nbody\n", "utf8");
	expect(readHandoffStatus(vault, "foreman", "h3")).toEqual({ status: "drafted", result: null });
});

test("readHandoffStatus recovers a done note whose unquoted result: breaks the YAML parse", () => {
	// Regression: observed LIVE. A repurposer node finished, wrote a correct
	// result containing "Note: the shared dir…" -- an unquoted YAML scalar with
	// a colon-space, which is invalid YAML. splitFrontmatter swallowed the error
	// and returned {}, so this read back as "pending"; the node then sat until
	// the 15-minute timeout and failed, discarding completed work.
	const vault = mkdtempSync(join(tmpdir(), "hq-"));
	const inbox = handoffInbox(vault, "repurposer");
	mkdirSync(inbox, { recursive: true });
	writeFileSync(
		join(inbox, "h6.md"),
		"---\nhandoff_id: h6\nfrom: conductor\nto: repurposer\nstatus: done\nrun_id: r1\nresult: Smoke test PASS (read-only) — viral-hooks reachable. Note: the shared dir the strategist cited carries viral-hooks but NOT post-grader.\n---\n## Task\nsmoke\n",
		"utf8",
	);
	const s = readHandoffStatus(vault, "repurposer", "h6");
	expect(s?.status).toBe("done");
	expect(s?.result).toContain("Note: the shared dir");
});

test("readHandoffStatus still reports pending for a note the agent has not touched", () => {
	// The fallback must not manufacture a status: a genuinely pending note has
	// to keep reading as pending, or the pickup timeout stops protecting us.
	const vault = mkdtempSync(join(tmpdir(), "hq-"));
	writeDispatchNote(vault, { slug: "foreman", handoffId: "h7", runId: "r1", task: "t" });
	expect(readHandoffStatus(vault, "foreman", "h7")).toEqual({ status: "pending", result: null });
});

test("readHandoffStatus recovers status from a malformed note with no result at all", () => {
	const vault = mkdtempSync(join(tmpdir(), "hq-"));
	const inbox = handoffInbox(vault, "foreman");
	mkdirSync(inbox, { recursive: true });
	// `reason:` is unquoted and colon-laden => YAML dies, but status: is intact.
	writeFileSync(
		join(inbox, "h8.md"),
		"---\nhandoff_id: h8\nstatus: rejected\nreason: bad input: not usable\n---\nbody\n",
		"utf8",
	);
	const s = readHandoffStatus(vault, "foreman", "h8");
	expect(s?.status).toBe("rejected");
});

test("clearDispatchNote lets a fresh writeDispatchNote replace a stale (dedup-blocked) note", () => {
	const vault = mkdtempSync(join(tmpdir(), "hq-"));
	writeDispatchNote(vault, { slug: "foreman", handoffId: "h4", runId: "r1", task: "first attempt" });
	// A second write for the same handoffId no-ops (existing dedup behavior):
	writeDispatchNote(vault, { slug: "foreman", handoffId: "h4", runId: "r1", task: "should be ignored" });
	expect(readHandoffStatus(vault, "foreman", "h4")).toEqual({ status: "pending", result: null });

	clearDispatchNote(vault, "foreman", "h4");
	expect(readHandoffStatus(vault, "foreman", "h4")).toBeNull();

	// Now a fresh dispatch note writes again instead of no-oping.
	writeDispatchNote(vault, { slug: "foreman", handoffId: "h4", runId: "r1", task: "retry" });
	expect(readHandoffStatus(vault, "foreman", "h4")).toEqual({ status: "pending", result: null });
});

test("clearDispatchNote also clears a note that already moved to done/", () => {
	const vault = mkdtempSync(join(tmpdir(), "hq-"));
	const inbox = handoffInbox(vault, "foreman");
	const doneDir = join(inbox, "done");
	mkdirSync(doneDir, { recursive: true });
	writeFileSync(join(doneDir, "h5.md"), "---\nhandoff_id: h5\nstatus: done\nresult: out\n---\nbody\n", "utf8");
	expect(readHandoffStatus(vault, "foreman", "h5")).toEqual({ status: "done", result: "out" });

	clearDispatchNote(vault, "foreman", "h5");
	expect(readHandoffStatus(vault, "foreman", "h5")).toBeNull();

	writeDispatchNote(vault, { slug: "foreman", handoffId: "h5", runId: "r1", task: "retry" });
	expect(readHandoffStatus(vault, "foreman", "h5")).toEqual({ status: "pending", result: null });
});

test("clearDispatchNote is a safe no-op when no note exists", () => {
	const vault = mkdtempSync(join(tmpdir(), "hq-"));
	expect(() => clearDispatchNote(vault, "foreman", "does-not-exist")).not.toThrow();
});
