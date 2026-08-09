#!/usr/bin/env bun
/**
 * Stock the queue — the weekly producer.
 *
 * Counts what is on the approvable shelf. If it's below target, shops the Google
 * Drive product-photo library for pictures that have never been posted, asks a model
 * to describe each one from the photo itself, and runs the result through the SAME
 * `createDraft` path as every intake door: upload -> HLD copy -> voice check ->
 * pending note. Then it tells Ryan there is something to approve.
 *
 * It never approves and never publishes — `createDraft` writes `approved: false` and
 * the drain is the only thing that ships. The worst a bad run can do is put a draft
 * on the shelf that Ryan declines, which is the cheapest possible failure.
 *
 *   ./scripts/stock-queue.sh --dry-run    # what it WOULD make, no calls, no writes
 *   ./scripts/stock-queue.sh              # make them
 *   ./scripts/stock-queue.sh --count 2    # override the shortfall
 *
 * Runs under bun (no Electron) so launchd fires it with the app closed.
 * BLOTATO_API_KEY must be injected (stock-queue.sh resolves it).
 */
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	createDraft,
	mediaTypeFor,
} from "../src/main/lib/approval-queue/intake";
import {
	QUEUE_DIR,
	realIntakeDeps,
} from "../src/main/lib/approval-queue/intake-runner";
import { telegramNotifier } from "../src/main/lib/approval-queue/notify";
import { readNote } from "../src/main/lib/approval-queue/queue";
import {
	BANK_TARGET,
	bankShortfall,
	hintPrompt,
	pickPhotos,
	readHint,
} from "../src/main/lib/approval-queue/stock";

const ADE_HOME = process.env.ADE_HOME_DIR || join(homedir(), ".ade");

/** Which photos have already become posts. See LEDGER note in the loop below. */
const LEDGER = join(ADE_HOME, "stock-queue-used.json");

/**
 * The library. Read-only: a photo is never moved or consumed, only recorded, because
 * this folder is Ryan's archive and not a conveyor. `_Drop` is the conveyor.
 *
 * `JDS/` is deliberately NOT here — it is 645 supplier catalog images, not Hand Lane
 * product photography, and posting one would be advertising someone else's blank.
 */
const LIBRARY =
	process.env.STOCK_LIBRARY_DIR ||
	join(
		homedir(),
		"Library/CloudStorage/GoogleDrive-handlanedesigns@gmail.com/My Drive/Social Media/Product Pictures",
	);

/**
 * The vision pass runs on Sonnet, not the Opus the caption writer uses. Reading a
 * photo and naming what is in it is not the hard part of this job; writing in Ryan's
 * voice is, and that call is unchanged.
 */
const HINT_MODEL = process.env.STOCK_HINT_MODEL || "claude-sonnet-5";

/**
 * Where a stocked post goes by default. The pair the live campaign actually posts to,
 * and both have caption caps a normal caption cannot breach. Threads is deliberately
 * absent: its 500-character cap is *below* the length these captions naturally run,
 * so including it would park good drafts at blocked instead of on the shelf. The
 * approval screen's WHERE picker is still the final say.
 */
const STOCK_PLATFORMS = "instagram + facebook";

function loadUsed(): string[] {
	try {
		const j = JSON.parse(readFileSync(LEDGER, "utf8")) as { used?: string[] };
		return Array.isArray(j.used) ? j.used : [];
	} catch {
		return [];
	}
}

function saveUsed(used: string[]): void {
	mkdirSync(ADE_HOME, { recursive: true });
	writeFileSync(LEDGER, JSON.stringify({ used }, null, 2), "utf8");
}

/** Ask the model what's in the photo. Returns null on SKIP, a refusal, or a failure —
 *  every one of which means "move on to the next picture", not "abort the run". */
function describePhoto(path: string): string | null {
	const r = spawnSync(
		"claude",
		["-p", hintPrompt(path), "--model", HINT_MODEL, "--output-format", "json"],
		{ encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 180_000 },
	);
	if (r.status !== 0 || !r.stdout) {
		console.error(
			`stock-queue: describe failed (status ${r.status}): ${(r.stderr || "").slice(0, 200)}`,
		);
		return null;
	}
	try {
		const { result } = JSON.parse(r.stdout) as { result?: string };
		return result ? readHint(result) : null;
	} catch {
		return null;
	}
}

/** Statuses of every note currently in the queue. A note too broken to parse still
 *  counts as inventory — it is something on the shelf needing attention, and treating
 *  it as absent would quietly over-produce. */
function shelf(): { status: string }[] {
	if (!existsSync(QUEUE_DIR)) return [];
	return readdirSync(QUEUE_DIR)
		.filter((f) => f.endsWith(".md"))
		.map((f) => {
			try {
				return {
					status: readNote(f, readFileSync(join(QUEUE_DIR, f), "utf8")).status,
				};
			} catch {
				return { status: "pending" };
			}
		});
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const dryRun = args.includes("--dry-run");
	const countArg = args.indexOf("--count");
	const override =
		countArg !== -1
			? Number.parseInt(args[countArg + 1] ?? "", 10)
			: Number.NaN;

	if (!existsSync(LIBRARY)) {
		console.error(`stock-queue: library not found at ${LIBRARY}`);
		process.exitCode = 1;
		return;
	}

	const onShelf = shelf();
	const need = Number.isFinite(override)
		? Math.max(0, override)
		: bankShortfall(onShelf);
	console.log(
		`stock-queue: ${onShelf.filter((n) => ["pending", "approved", ""].includes(n.status)).length} on the shelf, target ${BANK_TARGET} -> making ${need}`,
	);
	if (need === 0) return;

	const used = loadUsed();
	const available = readdirSync(LIBRARY).filter(
		(f) => !f.startsWith(".") && mediaTypeFor(f)?.kind === "photo",
	);
	const picks = pickPhotos(available, used, need);
	if (!picks.length) {
		console.log(
			`stock-queue: library exhausted (${used.length}/${available.length} used) — add photos to ${LIBRARY}`,
		);
		return;
	}

	if (dryRun) {
		console.log(`stock-queue: DRY RUN — would describe and draft:`);
		for (const p of picks) console.log(`  - ${p}`);
		return;
	}

	const apiKey = process.env.BLOTATO_API_KEY;
	if (!apiKey || apiKey.startsWith("op://")) {
		console.error(
			"stock-queue: BLOTATO_API_KEY unresolved — run via ./scripts/stock-queue.sh",
		);
		process.exitCode = 1;
		return;
	}
	const deps = realIntakeDeps(apiKey);
	const made: string[] = [];

	for (const file of picks) {
		const path = join(LIBRARY, file);
		const media = mediaTypeFor(file);
		if (!media) continue;

		const hint = describePhoto(path);
		// LEDGER: record the file the moment it is CONSIDERED, not once it succeeds.
		// A photo the model skipped (a logo, a mockup sheet) or that failed to draft
		// would otherwise be re-picked first every single week, so one bad file could
		// wedge the producer forever while the other 215 are never reached.
		used.push(file);
		if (!hint) {
			console.log(`stock-queue: ⏭  ${file} (not a usable product photo)`);
			continue;
		}

		try {
			const { draft } = await createDraft(deps, {
				bytes: new Uint8Array(readFileSync(path)),
				filename: file,
				contentType: media.contentType,
				kind: media.kind,
				hint,
				platform: STOCK_PLATFORMS,
				door: "stock",
			});
			console.log(`stock-queue: ✅ ${file} -> ${draft.slug}`);
			made.push(draft.slug);
		} catch (e) {
			console.error(
				`stock-queue: ❌ ${file}: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
	}

	saveUsed(used);
	console.log(`stock-queue: ${made.length} draft(s) added to the shelf`);

	// The point of a bank is that Ryan knows it's there. Best-effort: a failed ping
	// must not fail the run, the drafts are already on disk either way.
	const token = process.env.TELEGRAM_BOT_TOKEN;
	const chatId = process.env.TELEGRAM_CHAT_ID;
	if (made.length && token && chatId) {
		try {
			await telegramNotifier({
				botToken: token,
				chatId,
				fetch: globalThis.fetch,
			}).send(
				`🗂 ${made.length} new draft${made.length === 1 ? "" : "s"} on the shelf.\nReview at https://socialmedia.handlanedesigns.com/social`,
			);
		} catch {
			// notification is a courtesy, not part of the job
		}
	}
}

await main();
