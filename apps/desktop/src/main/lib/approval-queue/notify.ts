import type { DrainReport } from "./ship";

/**
 * Telegram notifications for the drain (RYA-166 feedback edge).
 *
 * The drain runs every 15 minutes. The ONE rule that makes this bearable instead
 * of maddening: notify on state CHANGES, not on state. A blocked note sits blocked
 * every tick — pinging it each time is 96 identical alerts a day. So only events
 * that correspond to a real transition this tick produce a message:
 *
 *   - shipped        -> a note went pending/approved -> scheduled (a write). Once,
 *                       naturally: the note is `scheduled` and inert next tick.
 *   - needs-review   -> a send failed or a claim went stale (a write). Once,
 *                       naturally: the note reads `needs-review` and is inert next.
 *   - blocked        -> "you approved this and it can't ship" (blocked is only
 *                       reachable PAST the approval gate). Worth ONE alert, but it
 *                       persists every tick, so it is deduped by (file, reason) via a
 *                       seen-set the caller persists across runs — announced on the
 *                       first tick, silent thereafter, re-armed if the block clears.
 *
 * The transport degrades gracefully: no creds -> no-op, exactly like
 * post-scheduler's optional Telegram ping. A notification failure must NEVER fail
 * a drain — the post already shipped; a missed ping is cosmetic.
 */

export interface NotifyDeps {
	/** Send one message. Resolves regardless of delivery — see sendTelegram. */
	send: (text: string) => Promise<void>;
}

const base = (p: string) => (p.split("/").pop() ?? p).replace(/\.md$/, "");

/** A blocked note's dedup key: file + reason. Reason is included so that fixing one
 *  block and hitting another (no-media -> no-page-id) re-notifies, but the SAME
 *  block does not re-fire every 15 minutes. */
function blockedKey(b: { file: string; reason: string }): string {
	return `${b.file}::${b.reason}`;
}

/**
 * Build the messages a drain run should emit, and the updated blocked-dedup set.
 * Pure: no I/O. Empty message list => nothing worth saying => stay silent.
 *
 * `seenBlocked` carries which (file, reason) blocks have already been announced.
 * It's returned PRUNED to only the blocks still present this run, so a note that
 * gets fixed and later re-blocks the same way can notify again.
 */
export function buildMessages(
	report: DrainReport,
	seenBlocked: ReadonlySet<string> = new Set(),
): { messages: string[]; seenBlocked: Set<string> } {
	const messages: string[] = [];

	// ship + needs-review are naturally once (both correspond to a status WRITE, so
	// the note is inert on the next tick) — no dedup needed.
	for (const s of report.shipped) {
		const when = new Date(s.scheduledTime).toLocaleString("en-US", {
			timeZone: "America/Chicago",
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit",
		});
		messages.push(
			`✅ Scheduled: ${base(s.file)}\n🕐 ${when} CT · ${s.ids.length} post(s)`,
		);
	}

	// published = confirmed live (the drain polled Blotato and every post fired). Once,
	// naturally — writing `published` is a status change, inert next tick. The payoff
	// message: the real links.
	for (const p of report.published) {
		messages.push(
			`🎉 Published: ${base(p.file)}${p.urls.length ? `\n${p.urls.join("\n")}` : ""}`,
		);
	}

	// Safety-critical: a needs-review note may be HALF-live (some platforms posted,
	// then a failure). Loud, and named so Ryan can go straight to it.
	for (const r of report.needsReview) {
		messages.push(
			`⚠️ NEEDS REVIEW: ${base(r.file)}\nA post may be partly live. Check Blotato before re-approving — the drain will not retry it.`,
		);
	}

	// blocked = "you approved this and it can't ship" (blocked is only reachable past
	// the approval gate). Worth one alert; but it persists every tick, so dedup by
	// (file, reason) and only announce NEW blocks.
	const nextSeen = new Set<string>();
	for (const b of report.blocked) {
		const key = blockedKey(b);
		nextSeen.add(key);
		if (!seenBlocked.has(key)) {
			messages.push(
				`🚫 Can't ship: ${base(b.file)}\n${b.reason}${b.detail ? ` — ${b.detail}` : ""}\nStill approved; fix it and it ships next run.`,
			);
		}
	}

	return { messages, seenBlocked: nextSeen };
}

/**
 * Send the drain's notifications. Returns the count actually dispatched. Never
 * throws — a failed ping cannot be allowed to fail a run that already shipped.
 */
export async function notify(
	report: DrainReport,
	deps: NotifyDeps,
	seenBlocked: ReadonlySet<string> = new Set(),
): Promise<{ sent: number; seenBlocked: Set<string> }> {
	const { messages, seenBlocked: next } = buildMessages(report, seenBlocked);
	let sent = 0;
	for (const m of messages) {
		try {
			await deps.send(m);
			sent += 1;
		} catch {
			// swallow — cosmetic
		}
	}
	return { sent, seenBlocked: next };
}

/**
 * A Telegram sender from a bot token + chat id. Returns a NotifyDeps whose `send`
 * resolves even on API failure (logs, never throws). If either credential is
 * missing, `send` is a silent no-op — mirrors post-scheduler's "skip silently if
 * unset" contract so an unconfigured machine simply gets no pings.
 */
export function telegramNotifier(opts: {
	botToken?: string;
	chatId?: string;
	fetch?: typeof globalThis.fetch;
}): NotifyDeps {
	const fetchFn = opts.fetch ?? globalThis.fetch;
	if (!opts.botToken || !opts.chatId) {
		return { send: async () => {} };
	}
	const url = `https://api.telegram.org/bot${opts.botToken}/sendMessage`;
	return {
		send: async (text: string) => {
			try {
				const res = await fetchFn(url, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ chat_id: opts.chatId, text }),
				});
				if (!res.ok) {
					console.error(
						`[drain-queue] telegram sendMessage -> HTTP ${res.status}`,
					);
				}
			} catch (e) {
				console.error(
					"[drain-queue] telegram send failed:",
					e instanceof Error ? e.message : e,
				);
			}
		},
	};
}
