import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDispatchNote, readHandoffStatus } from "./handoff";
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
