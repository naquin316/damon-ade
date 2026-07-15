#!/usr/bin/env bun
/**
 * Intake DOOR 2 — the drop folder.
 *
 * Watches `2. Areas/Social Media/Intake/` for new product photos. For each image it
 * finds, it takes a hint (a sidecar `<name>.txt`, or the filename itself), runs the
 * shared intake core (upload -> HLD copy -> pending draft in the Approval Queue), and
 * moves the image into `Intake/processed/` so it's handled exactly once. A photo that
 * fails goes to `Intake/processed/failed/` so a permanently-bad file can't burn a
 * `claude -p` call every run.
 *
 * Ryan drops a phone photo into the folder (via iCloud Files or Obsidian) with a
 * descriptive filename or a sidecar note, and a draft card appears — same pending ->
 * approve -> drain -> ship path as every other door. The vault stays the bus.
 *
 *   ./scripts/intake-folder.sh          # process whatever is waiting
 *
 * Like the drain, this runs under bun (no Electron) so launchd can fire it with the
 * app closed. BLOTATO_API_KEY must be injected (intake-folder.sh resolves it).
 */
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	statSync,
} from "node:fs";
import { basename, extname, join } from "node:path";
import { createDraft } from "../src/main/lib/approval-queue/intake";
import { realIntakeDeps } from "../src/main/lib/approval-queue/intake-runner";
import { vaultRoot } from "../src/main/lib/orchestrator/vault";

const INTAKE_DIR = join(vaultRoot(), "2. Areas/Social Media/Intake");
const PROCESSED_DIR = join(INTAKE_DIR, "processed");
const FAILED_DIR = join(PROCESSED_DIR, "failed");

/** Image extensions the door accepts. Blotato stores whatever bytes it's given; what
 *  a platform ultimately accepts is a downstream concern (and visible on the card). */
const IMAGE_EXT: Record<string, string> = {
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".webp": "image/webp",
	".heic": "image/heic",
	".heif": "image/heif",
};

/** Turn a filename into a usable hint when there's no sidecar: strip the extension,
 *  turn separators into spaces. `teacher-tumbler-30oz.jpg` -> `teacher tumbler 30oz`. */
function hintFromFilename(file: string): string {
	return basename(file, extname(file))
		.replace(/[-_]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** A safe, non-colliding destination in `dir` for `name` (adds -1, -2 … if taken). */
function uniqueDest(dir: string, name: string): string {
	let dest = join(dir, name);
	if (!existsSync(dest)) return dest;
	const ext = extname(name);
	const stem = basename(name, ext);
	for (let i = 1; ; i += 1) {
		dest = join(dir, `${stem}-${i}${ext}`);
		if (!existsSync(dest)) return dest;
	}
}

function moveTo(dir: string, path: string): void {
	mkdirSync(dir, { recursive: true });
	renameSync(path, uniqueDest(dir, basename(path)));
}

async function main(): Promise<void> {
	// Create the folder tree so the door exists for Ryan to drop into even on a fresh
	// machine, then there's simply nothing to process.
	mkdirSync(PROCESSED_DIR, { recursive: true });

	const apiKey = process.env.BLOTATO_API_KEY;
	if (!apiKey || apiKey.startsWith("op://")) {
		console.error(
			"intake-folder: BLOTATO_API_KEY unresolved — run via ./scripts/intake-folder.sh",
		);
		process.exitCode = 1;
		return;
	}

	const entries = readdirSync(INTAKE_DIR)
		.filter((f) => !f.startsWith("."))
		.filter((f) => extname(f).toLowerCase() in IMAGE_EXT)
		.sort();

	if (!entries.length) {
		console.log(`intake-folder: nothing waiting in ${INTAKE_DIR}`);
		return;
	}

	const deps = realIntakeDeps(apiKey);
	let made = 0;
	let failed = 0;

	for (const file of entries) {
		const path = join(INTAKE_DIR, file);
		// A dataless iCloud placeholder (0 bytes, or a `.icloud` stub) isn't downloaded
		// yet — skip it this run; it'll materialize and get picked up later.
		let size = 0;
		try {
			size = statSync(path).size;
		} catch {
			continue;
		}
		if (size === 0) {
			console.log(`intake-folder: ${file} not downloaded yet (0 bytes) — skipping`);
			continue;
		}

		// Hint: a sidecar `<name>.txt` wins; otherwise the filename itself.
		const sidecar = join(INTAKE_DIR, `${basename(file, extname(file))}.txt`);
		let hint = "";
		if (existsSync(sidecar)) {
			try {
				hint = readFileSync(sidecar, "utf8").trim();
			} catch {
				// unreadable sidecar -> fall back to the filename
			}
		}
		if (!hint) hint = hintFromFilename(file);
		if (!hint) hint = "product photo";

		try {
			const bytes = new Uint8Array(readFileSync(path));
			const { draft } = await createDraft(deps, {
				bytes,
				filename: file,
				contentType: IMAGE_EXT[extname(file).toLowerCase()] ?? "image/jpeg",
				hint,
				door: "folder",
			});
			console.log(`intake-folder: ✅ ${file} -> ${draft.slug}`);
			made += 1;
			moveTo(PROCESSED_DIR, path);
			if (existsSync(sidecar)) moveTo(PROCESSED_DIR, sidecar);
		} catch (e) {
			console.error(
				`intake-folder: ❌ ${file}: ${e instanceof Error ? e.message : String(e)}`,
			);
			failed += 1;
			// Quarantine the failure so it doesn't reprocess (and re-bill) every run.
			try {
				moveTo(FAILED_DIR, path);
				if (existsSync(sidecar)) moveTo(FAILED_DIR, sidecar);
			} catch {
				// if we can't even move it, leave it; next run will retry
			}
		}
	}

	console.log(`intake-folder: ${made} draft(s) created, ${failed} failed`);
	if (failed) process.exitCode = 1;
}

await main();
