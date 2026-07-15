#!/usr/bin/env bun
/**
 * Approval Queue consumer (RYA-166) — CLI entry.
 *
 * Scans `2. Areas/Social Media/Approval Queue/` and schedules every note a human
 * has marked `status: approved` via the Blotato REST API.
 *
 * Runs under `bun` rather than inside the Electron main process on purpose: the
 * whole value is approving from Obsidian on a phone while the Mac sits closed, and
 * an in-app watcher only fires while RyanOS is open — exactly when Ryan does not
 * need it. Nothing in this file's import graph touches Electron.
 *
 *   op run -- bun apps/desktop/scripts/drain-queue.ts            # dry run (default)
 *   op run -- bun apps/desktop/scripts/drain-queue.ts --ship     # actually schedule
 *
 * BLOTATO_API_KEY must be injected (op://Personal/Blotato/credential). It is never
 * read from a file and never logged.
 *
 * Design + invariants: docs/superpowers/specs/2026-07-14-approval-queue-consumer-design.md
 */
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
	type BlotatoAccount,
	createPost,
	indexAccounts,
	listAccounts,
} from "../src/main/lib/approval-queue/blotato";
import {
	notify,
	telegramNotifier,
} from "../src/main/lib/approval-queue/notify";
import {
	type DrainDeps,
	drain,
	formatCopyPreview,
	formatReport,
} from "../src/main/lib/approval-queue/ship";
import { TARGET_DEFAULTS } from "../src/main/lib/approval-queue/targets";
import { vaultRoot } from "../src/main/lib/orchestrator/vault";

const QUEUE_DIR = join(vaultRoot(), "2. Areas/Social Media/Approval Queue");
const ADE_HOME = process.env.ADE_HOME_DIR || join(homedir(), ".ade");
// Which (file, block-reason) pairs have already been announced, so a note that
// stays blocked doesn't re-alert every 15 minutes.
const NOTIFIED_STATE = join(ADE_HOME, "drain-queue-notified.json");

function loadSeenBlocked(): Set<string> {
	try {
		const raw = JSON.parse(readFileSync(NOTIFIED_STATE, "utf8"));
		return new Set(Array.isArray(raw) ? raw : []);
	} catch {
		return new Set();
	}
}

function saveSeenBlocked(seen: Set<string>): void {
	try {
		mkdirSync(ADE_HOME, { recursive: true });
		writeFileSync(NOTIFIED_STATE, JSON.stringify([...seen]), "utf8");
	} catch {
		// dedup state is best-effort; worst case is a duplicate alert, never a crash
	}
}

async function main(): Promise<void> {
	const ship = process.argv.includes("--ship");

	if (!existsSync(QUEUE_DIR)) {
		console.log(`Approval Queue not found at ${QUEUE_DIR} — nothing to do.`);
		return;
	}

	const apiKey = process.env.BLOTATO_API_KEY;
	if (!apiKey || apiKey.startsWith("op://")) {
		console.error(
			"BLOTATO_API_KEY is not set (or is an unresolved op:// reference).\n" +
				"Run under 1Password so the key is injected at runtime, never stored in a file:\n" +
				'  BLOTATO_API_KEY="op://Personal/Blotato/credential" op run -- bun apps/desktop/scripts/drain-queue.ts',
		);
		process.exitCode = 1;
		return;
	}

	const blotato = { fetch: globalThis.fetch, apiKey };

	// Fetch the account set once per run. This is what makes "you have no X account"
	// a reported classification instead of a failed post.
	let connected: Map<string, BlotatoAccount>;
	try {
		const accounts = await listAccounts(blotato);
		connected = indexAccounts(accounts);
		console.log(
			`Blotato: ${accounts.length} connected account(s) — ${[...connected.keys()].sort().join(", ") || "none"}`,
		);
	} catch (error) {
		console.error(
			`Could not reach Blotato: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exitCode = 1;
		return;
	}

	const deps: DrainDeps = {
		listNotes: () =>
			readdirSync(QUEUE_DIR)
				.filter((f) => f.endsWith(".md"))
				.sort()
				.map((f) => join(QUEUE_DIR, f)),
		read: (p) => readFileSync(p, "utf8"),
		write: (p, c) => writeFileSync(p, c, "utf8"),
		connected,
		targetDefaults: TARGET_DEFAULTS,
		send: (post, scheduledTime) =>
			createPost(blotato, {
				accountId: post.accountId,
				platform: post.platform,
				text: post.text,
				mediaUrls: post.mediaUrls,
				scheduledTime,
				...(post.pageId ? { pageId: post.pageId } : {}),
				...(post.boardId ? { boardId: post.boardId } : {}),
			}),
		now: () => Date.now(),
	};

	const report = await drain(deps, { ship });
	console.log(formatReport(report, { ship, at: new Date().toISOString() }));

	if (!ship && report.shippable.length) {
		// The copy is lifted out of the note body by a regex, so it stays reviewable
		// rather than trusted. Read it before you --ship.
		console.log(formatCopyPreview(report));
		console.log("\nRe-run with --ship to schedule the above.");
	}

	// Telegram feedback edge (RYA-166). Only on a real --ship run: a dry run changes
	// nothing, so there is nothing to announce. Creds come from the environment
	// (drain-queue.sh resolves them); absent creds -> silent no-op notifier, so an
	// unconfigured machine simply gets no pings. Dedup state persists across ticks so
	// a blocked note alerts once, not every 15 minutes.
	if (ship) {
		const notifier = telegramNotifier({
			botToken: process.env.TELEGRAM_BOT_TOKEN,
			chatId: process.env.TELEGRAM_CHAT_ID,
			fetch: globalThis.fetch,
		});
		const { sent, seenBlocked } = await notify(
			report,
			notifier,
			loadSeenBlocked(),
		);
		saveSeenBlocked(seenBlocked);
		if (sent) console.log(`notified: ${sent} message(s)`);
	}

	if (report.errors.length) process.exitCode = 1;
}

await main();
