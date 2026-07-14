import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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
