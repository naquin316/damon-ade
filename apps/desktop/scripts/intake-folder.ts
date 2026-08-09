#!/usr/bin/env bun
/**
 * Intake DOOR 2 — the drop folder.
 *
 * Watches every configured drop root for new product media. For each file it finds it
 * takes a hint (a sidecar `<name>.txt`, or the filename itself), runs the shared
 * intake core (upload -> HLD copy -> voice check -> pending draft in the Approval
 * Queue), and moves the file into `processed/` so it's handled exactly once. A file
 * that fails goes to `processed/failed/` so a permanently-bad file can't burn a
 * `claude -p` call every run.
 *
 * TWO ROOTS, both scanned (2026-08-09):
 *   1. the vault `2. Areas/Social Media/Intake/` — the original door, still live
 *   2. Google Drive `My Drive/Social Media/_Drop/` — Ryan's working library
 * Drive is a MOUNTED FOLDER (`~/Library/CloudStorage/GoogleDrive-…`), so this needs
 * no API, no OAuth and no sync of its own; it is `readdir` like anything else. The
 * old root is kept rather than cut over so a drop in the place that already worked
 * doesn't silently stop producing cards. Override with `SOCIAL_INTAKE_DIRS` (a
 * colon-separated list) — a missing root is skipped, not an error.
 *
 * SUBFOLDER = ROUTING. One level below a root is read as intent: a known name in
 * ROUTES (Reel/Post/Story) sets the note's platforms; any other name is treated as
 * context and prepended to the hint, so `_Drop/Teacher Tumblers/IMG_1.jpg` gets
 * "Teacher Tumblers" in its brief for free. A typo'd folder degrades to context,
 * which is visible on the card, rather than to a wrong platform, which is not.
 *
 * Video is accepted alongside photos — see MEDIA_TYPES in intake.ts.
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
import { homedir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import {
	createDraft,
	mediaTypeFor,
} from "../src/main/lib/approval-queue/intake";
import { realIntakeDeps } from "../src/main/lib/approval-queue/intake-runner";
import { vaultRoot } from "../src/main/lib/orchestrator/vault";

/** Drop roots, in scan order. A root that doesn't exist is skipped. */
const DEFAULT_ROOTS = [
	join(vaultRoot(), "2. Areas/Social Media/Intake"),
	join(
		homedir(),
		"Library/CloudStorage/GoogleDrive-handlanedesigns@gmail.com/My Drive/Social Media/_Drop",
	),
];

function roots(): string[] {
	const override = process.env.SOCIAL_INTAKE_DIRS;
	return override ? override.split(":").filter(Boolean) : DEFAULT_ROOTS;
}

/**
 * Subfolder name -> the note's `platform:` field (`+`-separated, per parsePlatforms).
 *
 * Deliberately small. These are the three shapes the pipeline actually posts today;
 * anything else is better as hint context than as a guess about where it should go.
 * The approval UI's WHERE picker is still the final say — this only sets the default.
 */
const ROUTES: Record<string, string> = {
	reel: "instagram + facebook",
	reels: "instagram + facebook",
	post: "instagram + facebook",
	posts: "instagram + facebook",
	story: "instagram",
	stories: "instagram",
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

/** One droppable file, with where it came from already resolved into intent. */
interface Candidate {
	path: string;
	file: string;
	/** Absolute `processed/` dir for this file's root. */
	processed: string;
	/** Subfolder name, or "" when the file sat at the root. */
	folder: string;
}

/** Everything waiting under one root: its own files, plus one level of subfolders.
 *  `processed` (and its `failed` child) are skipped — that's where we move things TO. */
function scan(root: string): Candidate[] {
	const processed = join(root, "processed");
	const out: Candidate[] = [];

	const collect = (dir: string, folder: string): void => {
		for (const file of readdirSync(dir).sort()) {
			if (file.startsWith(".")) continue;
			if (mediaTypeFor(file))
				out.push({ path: join(dir, file), file, processed, folder });
		}
	};

	collect(root, "");
	for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) =>
		a.name.localeCompare(b.name),
	)) {
		if (!entry.isDirectory()) continue;
		if (entry.name === "processed" || entry.name.startsWith(".")) continue;
		collect(join(root, entry.name), entry.name);
	}
	return out;
}

async function main(): Promise<void> {
	const apiKey = process.env.BLOTATO_API_KEY;
	if (!apiKey || apiKey.startsWith("op://")) {
		console.error(
			"intake-folder: BLOTATO_API_KEY unresolved — run via ./scripts/intake-folder.sh",
		);
		process.exitCode = 1;
		return;
	}

	const waiting: Candidate[] = [];
	for (const root of roots()) {
		if (!existsSync(root)) {
			console.log(`intake-folder: ${root} not present — skipping`);
			continue;
		}
		// Create the tree so the door exists to drop into even on a fresh machine.
		mkdirSync(join(root, "processed"), { recursive: true });
		waiting.push(...scan(root));
	}

	if (!waiting.length) {
		console.log("intake-folder: nothing waiting");
		return;
	}

	const deps = realIntakeDeps(apiKey);
	let made = 0;
	let failed = 0;

	for (const { path, file, processed, folder } of waiting) {
		const media = mediaTypeFor(file);
		if (!media) continue; // unreachable; scan already filtered

		// A dataless iCloud/Drive placeholder (0 bytes, or a `.icloud` stub) isn't
		// downloaded yet — skip it this run; it'll materialize and get picked up later.
		let size = 0;
		try {
			size = statSync(path).size;
		} catch {
			continue;
		}
		if (size === 0) {
			console.log(
				`intake-folder: ${file} not downloaded yet (0 bytes) — skipping`,
			);
			continue;
		}

		// Hint: a sidecar `<name>.txt` wins; otherwise the filename itself. A subfolder
		// that isn't a route contributes its name as context.
		const sidecar = join(dirname(path), `${basename(file, extname(file))}.txt`);
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

		const platform = ROUTES[folder.toLowerCase()];
		if (folder && !platform) hint = `${folder}: ${hint}`;

		try {
			const bytes = new Uint8Array(readFileSync(path));
			const { draft } = await createDraft(deps, {
				bytes,
				filename: file,
				contentType: media.contentType,
				kind: media.kind,
				hint,
				platform,
				door: "folder",
			});
			console.log(
				`intake-folder: ✅ ${folder ? `${folder}/` : ""}${file} -> ${draft.slug}${platform ? ` [${platform}]` : ""}`,
			);
			made += 1;
			moveTo(processed, path);
			if (existsSync(sidecar)) moveTo(processed, sidecar);
		} catch (e) {
			console.error(
				`intake-folder: ❌ ${file}: ${e instanceof Error ? e.message : String(e)}`,
			);
			failed += 1;
			// Quarantine the failure so it doesn't reprocess (and re-bill) every run.
			try {
				moveTo(join(processed, "failed"), path);
				if (existsSync(sidecar)) moveTo(join(processed, "failed"), sidecar);
			} catch {
				// if we can't even move it, leave it; next run will retry
			}
		}
	}

	console.log(`intake-folder: ${made} draft(s) created, ${failed} failed`);
	if (failed) process.exitCode = 1;
}

await main();
