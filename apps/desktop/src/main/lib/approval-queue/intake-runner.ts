/**
 * Real (non-injected) wiring for the intake core, shared by all three front doors:
 * the web GUI (queue-server.ts), the drop-folder watcher (intake-folder.ts), and the
 * Telegram listener (intake-telegram.ts). intake.ts stays pure and tested; the side
 * effects — talk to Blotato, spawn `claude -p`, write into the vault — live here, in
 * ONE place, so a door is just "read a photo + a hint, call runIntake".
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { uploadMedia } from "./blotato";
import { type Draft, type IntakeDeps } from "./intake";
import { vaultRoot } from "../orchestrator/vault";

/** The one queue the drain scans. Every door writes its draft here. */
export const QUEUE_DIR = join(
	vaultRoot(),
	"2. Areas/Social Media/Approval Queue",
);

/**
 * Generate caption copy via `claude -p`, reusing Ryan's subscription (no API key).
 * spawnSync with an ARGV ARRAY, not a shell string — so the RYA-176 injection class
 * (backticks/$ in a prompt executed by /bin/sh) simply cannot happen. Returns the
 * model's final text from `--output-format json`.
 */
export function claudeGenerateCopy(system: string, prompt: string): string {
	const r = spawnSync(
		"claude",
		[
			"-p",
			prompt,
			"--model",
			"claude-opus-4-8[1m]",
			"--append-system-prompt",
			system,
			"--output-format",
			"json",
		],
		{ encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 120_000 },
	);
	if (r.status !== 0 || !r.stdout) {
		throw new Error(
			`claude copy-gen failed (status ${r.status}): ${(r.stderr || "").slice(0, 200)}`,
		);
	}
	const parsed = JSON.parse(r.stdout) as { result?: string };
	if (!parsed.result) throw new Error("claude copy-gen: no result in output");
	return parsed.result;
}

/**
 * The concrete IntakeDeps every door passes to createDraft: upload to Blotato,
 * generate copy with `claude -p`, and write the note into the queue. `apiKey` must
 * be a resolved Blotato key (not an unresolved `op://` ref) — the caller checks.
 */
export function realIntakeDeps(apiKey: string): IntakeDeps {
	const blotato = { fetch: globalThis.fetch, apiKey };
	return {
		upload: (f) => uploadMedia(blotato, f),
		generateCopy: (system, prompt) =>
			Promise.resolve(claudeGenerateCopy(system, prompt)),
		writeNote: (d: Draft) => {
			const p = join(QUEUE_DIR, d.filename);
			writeFileSync(p, d.content, "utf8");
			return p;
		},
		today: () => new Date().toISOString().slice(0, 10),
	};
}
