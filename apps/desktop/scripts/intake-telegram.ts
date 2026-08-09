#!/usr/bin/env bun
/**
 * Intake DOOR 3 — Telegram photo intake.
 *
 * A long-poll listener on the Hermes bot (the same bot that already DMs Ryan the
 * drain's confirmations). Send it a product photo with a caption and it runs the
 * shared intake core (upload -> HLD copy -> pending draft) and replies with the card
 * it made. The caption IS the hint. Same pending -> approve -> drain -> ship path as
 * every other door; the vault stays the bus.
 *
 * A persistent process (launchd KeepAlive), not a timer: getUpdates long-polls with a
 * 50s server-side wait, so it's near-idle between messages and reacts instantly to
 * one. The update offset is persisted so a restart never reprocesses a photo.
 *
 * Only messages from Ryan's own chat id are honored — the bot ignores everyone else,
 * so a leaked bot username can't inject drafts into his queue.
 *
 *   ./scripts/intake-telegram.sh
 *
 * Runs under bun (no Electron). Requires BLOTATO_API_KEY + TELEGRAM_BOT_TOKEN +
 * TELEGRAM_CHAT_ID in the environment (intake-telegram.sh resolves them).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import {
	createDraft,
	type MediaKind,
	mediaKindFrom,
	mediaTypeFor,
} from "../src/main/lib/approval-queue/intake";
import { realIntakeDeps } from "../src/main/lib/approval-queue/intake-runner";
import { telegramNotifier } from "../src/main/lib/approval-queue/notify";

const ADE_HOME = process.env.ADE_HOME_DIR || join(homedir(), ".ade");
const OFFSET_FILE = join(ADE_HOME, "intake-telegram-offset.json");

function loadOffset(): number {
	try {
		const j = JSON.parse(readFileSync(OFFSET_FILE, "utf8")) as {
			offset?: number;
		};
		return typeof j.offset === "number" ? j.offset : 0;
	} catch {
		return 0;
	}
}

function saveOffset(offset: number): void {
	try {
		mkdirSync(ADE_HOME, { recursive: true });
		writeFileSync(OFFSET_FILE, JSON.stringify({ offset }), "utf8");
	} catch {
		// best-effort: worst case a restart reprocesses the last batch
	}
}

// ── minimal Telegram Bot API surface we need ──────────────────────────────────
interface TgPhotoSize {
	file_id: string;
	file_size?: number;
	width?: number;
	height?: number;
}
interface TgDocument {
	file_id: string;
	file_name?: string;
	mime_type?: string;
}
interface TgMessage {
	message_id: number;
	chat?: { id?: number | string };
	from?: { id?: number | string };
	caption?: string;
	photo?: TgPhotoSize[];
	document?: TgDocument;
	/** Sent as a video rather than a file. Same shape as a document for our purposes. */
	video?: TgDocument;
}
interface TgUpdate {
	update_id: number;
	message?: TgMessage;
}

async function tgGet(
	token: string,
	method: string,
	params: Record<string, string | number>,
): Promise<unknown> {
	const qs = new URLSearchParams(
		Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
	);
	const res = await fetch(
		`https://api.telegram.org/bot${token}/${method}?${qs}`,
	);
	const json = (await res.json()) as { ok?: boolean; result?: unknown };
	if (!json.ok)
		throw new Error(
			`telegram ${method} failed: ${JSON.stringify(json).slice(0, 160)}`,
		);
	return json.result;
}

/** Resolve a file_id to its downloadable bytes + a filename. */
async function downloadFile(
	token: string,
	fileId: string,
): Promise<{ bytes: Uint8Array; filename: string }> {
	const file = (await tgGet(token, "getFile", { file_id: fileId })) as {
		file_path?: string;
	};
	if (!file.file_path) throw new Error("getFile: no file_path");
	const res = await fetch(
		`https://api.telegram.org/file/bot${token}/${file.file_path}`,
	);
	if (!res.ok) throw new Error(`file download failed: HTTP ${res.status}`);
	const bytes = new Uint8Array(await res.arrayBuffer());
	return { bytes, filename: basename(file.file_path) };
}

/** Pick the media to ingest from a message: the largest photo size, a sent video, or
 *  an image/video document (phone "send as file"). Null if the message carries none.
 *  Extension->type comes from intake.ts's one table, so this door and the drop folder
 *  can't disagree about what is droppable. */
function pickMedia(msg: TgMessage): {
	fileId: string;
	filename: string;
	contentType: string;
	kind: MediaKind;
} | null {
	if (msg.photo?.length) {
		// Photo sizes come smallest-first; the last is the highest resolution.
		const largest = msg.photo[msg.photo.length - 1];
		return {
			fileId: largest.file_id,
			filename: "telegram-photo.jpg",
			contentType: "image/jpeg",
			kind: "photo",
		};
	}
	const file = msg.video ?? msg.document;
	if (!file) return null;
	const mime = (file.mime_type ?? "").toLowerCase();
	const name =
		file.file_name || (msg.video ? "telegram-video.mp4" : "telegram-media");
	// Trust the declared mime when it's media; otherwise fall back to the extension.
	const byExt = mediaTypeFor(name);
	if (!mime.startsWith("image/") && !mime.startsWith("video/") && !byExt)
		return null;
	const contentType = mime || byExt?.contentType || "image/jpeg";
	return {
		fileId: file.file_id,
		filename: name,
		contentType,
		kind: mediaKindFrom(contentType),
	};
}

async function main(): Promise<void> {
	const apiKey = process.env.BLOTATO_API_KEY;
	const token = process.env.TELEGRAM_BOT_TOKEN;
	const allowedChat = process.env.TELEGRAM_CHAT_ID;
	if (!apiKey || apiKey.startsWith("op://")) {
		console.error(
			"intake-telegram: BLOTATO_API_KEY unresolved — use ./scripts/intake-telegram.sh",
		);
		process.exitCode = 1;
		return;
	}
	if (!token || !allowedChat) {
		console.error(
			"intake-telegram: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required.",
		);
		process.exitCode = 1;
		return;
	}

	const deps = realIntakeDeps(apiKey);
	const reply = telegramNotifier({
		botToken: token,
		chatId: allowedChat,
		fetch: globalThis.fetch,
	});

	let offset = loadOffset();
	console.log(
		`intake-telegram: listening (offset ${offset}) — send a photo + caption to the bot.`,
	);

	// The long-poll loop. getUpdates blocks up to `timeout` seconds server-side, so
	// this spins at most once per 50s when idle and returns instantly on a message.
	// A network hiccup just pauses and retries; it never exits.
	for (;;) {
		let updates: TgUpdate[];
		try {
			updates = (await tgGet(token, "getUpdates", {
				offset,
				timeout: 50,
			})) as TgUpdate[];
		} catch (e) {
			console.error(
				"intake-telegram: getUpdates error, retrying:",
				e instanceof Error ? e.message : e,
			);
			await new Promise((r) => setTimeout(r, 5000));
			continue;
		}

		for (const u of updates) {
			offset = u.update_id + 1; // advance past every update, handled or not
			const msg = u.message;
			if (!msg) continue;

			const from = String(msg.chat?.id ?? msg.from?.id ?? "");
			if (from !== String(allowedChat)) {
				// Someone who isn't Ryan messaged the bot — ignore silently.
				continue;
			}

			const img = pickMedia(msg);
			if (!img) continue; // not a media message; nothing to do

			const hint = (msg.caption ?? "").trim();
			if (!hint) {
				await reply.send(
					"📸 Got it, but I need a caption to write the copy. Send it again with a line like: 30oz teacher tumbler, engraved name, $48.",
				);
				continue;
			}

			try {
				const { bytes, filename } = await downloadFile(token, img.fileId);
				const { draft } = await createDraft(deps, {
					bytes,
					filename:
						img.filename !== "telegram-photo.jpg" ? img.filename : filename,
					contentType: img.contentType,
					kind: img.kind,
					hint,
					door: "telegram",
				});
				console.log(`intake-telegram: ✅ -> ${draft.slug}`);
				await reply.send(
					`✅ Draft created: ${draft.slug}\nReview + approve it in the Approvals viewer.`,
				);
			} catch (e) {
				console.error(
					"intake-telegram: draft failed:",
					e instanceof Error ? e.message : e,
				);
				await reply.send(
					`❌ Couldn't make a draft: ${e instanceof Error ? e.message : String(e)}`,
				);
			}
		}

		if (updates.length) saveOffset(offset);
	}
}

await main();
