import { describe, expect, test } from "bun:test";
import {
	buildMessages,
	notify,
	NUDGE_AFTER_DAYS,
	telegramNotifier,
} from "./notify";
import type { DrainReport } from "./ship";

function report(over: Partial<DrainReport> = {}): DrainReport {
	return {
		shippable: [],
		shipped: [],
		published: [],
		blocked: [],
		waiting: [],
		needsReview: [],
		claimed: [],
		untouched: [],
		errors: [],
		...over,
	};
}

describe("buildMessages — ship + needs-review", () => {
	test("a shipped note produces one message naming the file", () => {
		const { messages } = buildMessages(
			report({
				shipped: [
					{
						file: "/q/teacher-tumbler.md",
						ids: ["abc"],
						scheduledTime: "2026-07-20T20:10:00.000Z",
					},
				],
			}),
		);
		expect(messages).toHaveLength(1);
		expect(messages[0]).toContain("teacher-tumbler");
		expect(messages[0]).toContain("✅");
	});

	test("needs-review is loud and warns about a half-live post", () => {
		const { messages } = buildMessages(
			report({ needsReview: [{ file: "/q/x.md", since: null }] }),
		);
		expect(messages[0]).toContain("NEEDS REVIEW");
		expect(messages[0]).toContain("Check Blotato");
	});

	test("a quiet run (nothing changed) says nothing", () => {
		const { messages } = buildMessages(
			report({ untouched: [{ file: "/q/x.md", status: "pending" }] }),
		);
		expect(messages).toEqual([]);
	});
});

describe("buildMessages — blocked dedup (the anti-spam invariant)", () => {
	// The drain runs every 15 min. A blocked note stays blocked. Without dedup this
	// is 96 identical alerts a day.
	test("a blocked note notifies the FIRST time only", () => {
		const r = report({
			blocked: [
				{
					file: "/q/ig.md",
					reason: "no-media",
					detail: "instagram requires a media URL",
				},
			],
		});

		const first = buildMessages(r, new Set());
		expect(first.messages).toHaveLength(1);
		expect(first.messages[0]).toContain("Can't ship");

		// next tick, same block, carrying forward the seen-set: silence
		const second = buildMessages(r, first.seenBlocked);
		expect(second.messages).toEqual([]);
	});

	test("the seen-set is pruned so a fixed-then-reblocked note can re-alert", () => {
		const blockedRun = report({
			blocked: [{ file: "/q/ig.md", reason: "no-media" }],
		});
		const first = buildMessages(blockedRun, new Set());
		expect(first.seenBlocked.has("/q/ig.md::no-media")).toBe(true);

		// the note gets fixed and ships — no blocks this run. seen-set empties.
		const fixed = buildMessages(
			report({
				shipped: [
					{
						file: "/q/ig.md",
						ids: ["1"],
						scheduledTime: "2026-07-20T20:10:00.000Z",
					},
				],
			}),
			first.seenBlocked,
		);
		expect(fixed.seenBlocked.size).toBe(0);

		// later it re-blocks the same way -> alerts again, because seen was pruned
		const again = buildMessages(blockedRun, fixed.seenBlocked);
		expect(again.messages).toHaveLength(1);
	});

	test("a DIFFERENT block reason on the same file re-alerts", () => {
		const first = buildMessages(
			report({ blocked: [{ file: "/q/fb.md", reason: "no-media" }] }),
			new Set(),
		);
		const second = buildMessages(
			report({ blocked: [{ file: "/q/fb.md", reason: "no-page-id" }] }),
			first.seenBlocked,
		);
		expect(second.messages).toHaveLength(1);
		expect(second.messages[0]).toContain("no-page-id");
	});
});

describe("notify — resilience", () => {
	test("a send failure never throws and does not stop the rest", async () => {
		let calls = 0;
		const deps = {
			send: async () => {
				calls += 1;
				if (calls === 1) throw new Error("telegram down");
			},
		};
		const r = report({
			shipped: [
				{
					file: "/q/a.md",
					ids: ["1"],
					scheduledTime: "2026-07-20T20:10:00.000Z",
				},
			],
			needsReview: [{ file: "/q/b.md", since: null }],
		});
		const { sent } = await notify(r, deps);
		// two messages attempted, first threw, second delivered
		expect(calls).toBe(2);
		expect(sent).toBe(1);
	});

	test("returns the pruned seen-set for the caller to persist", async () => {
		const deps = { send: async () => {} };
		const r = report({ blocked: [{ file: "/q/a.md", reason: "no-media" }] });
		const { seenBlocked } = await notify(r, deps);
		expect([...seenBlocked]).toEqual(["/q/a.md::no-media"]);
	});
});

describe("telegramNotifier", () => {
	test("no creds -> silent no-op send that never throws", async () => {
		const n = telegramNotifier({});
		await n.send("hi"); // must not throw
	});

	test("with creds it POSTs to the bot sendMessage endpoint", async () => {
		const calls: { url: string; body: unknown }[] = [];
		const fetchFn = (async (url: string, init?: RequestInit) => {
			calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
			return { ok: true, status: 200 } as Response;
		}) as unknown as typeof globalThis.fetch;

		const n = telegramNotifier({
			botToken: "TOK",
			chatId: "123",
			fetch: fetchFn,
		});
		await n.send("hello");

		expect(calls[0]?.url).toBe("https://api.telegram.org/botTOK/sendMessage");
		expect(calls[0]?.body).toEqual({ chat_id: "123", text: "hello" });
	});

	test("an API failure is swallowed, not thrown", async () => {
		const fetchFn = (async () =>
			({
				ok: false,
				status: 400,
			}) as Response) as unknown as typeof globalThis.fetch;
		const n = telegramNotifier({
			botToken: "TOK",
			chatId: "123",
			fetch: fetchFn,
		});
		await n.send("hello"); // must not throw
	});
});

describe("buildMessages — ready-and-waiting nudge", () => {
	const NOW = Date.parse("2026-08-08T12:00:00Z");
	const w = (file: string, ageDays: number | null) => ({ file, ageDays });

	test("nudges once when a ready post is older than the threshold", () => {
		const { messages } = buildMessages(
			report({ waiting: [w("/q/a.md", 31)] }),
			new Set(),
			NOW,
		);
		expect(messages).toHaveLength(1);
		expect(messages[0]).toContain("1 post ready and waiting on you");
		expect(messages[0]).toContain("31 days old");
		expect(messages[0]).toContain("http://localhost:4319");
	});

	test("stays silent below the threshold — a fresh queue is healthy", () => {
		const { messages } = buildMessages(
			report({ waiting: [w("/q/a.md", NUDGE_AFTER_DAYS - 1)] }),
			new Set(),
			NOW,
		);
		expect(messages).toEqual([]);
	});

	test("does not nudge twice in the same day", () => {
		const first = buildMessages(
			report({ waiting: [w("/q/a.md", 31)] }),
			new Set(),
			NOW,
		);
		expect(first.messages).toHaveLength(1);
		// Second tick, 15 minutes later, carrying the returned marker forward.
		const second = buildMessages(
			report({ waiting: [w("/q/a.md", 31)] }),
			first.seenBlocked,
			NOW + 15 * 60 * 1000,
		);
		expect(second.messages).toEqual([]);
	});

	test("re-arms the next day", () => {
		const day1 = buildMessages(
			report({ waiting: [w("/q/a.md", 31)] }),
			new Set(),
			NOW,
		);
		const day2 = buildMessages(
			report({ waiting: [w("/q/a.md", 32)] }),
			day1.seenBlocked,
			NOW + 24 * 60 * 60 * 1000,
		);
		expect(day2.messages).toHaveLength(1);
		// and yesterday's marker is pruned rather than accumulating forever
		expect([...day2.seenBlocked].filter((k) => k.startsWith("nudge:"))).toEqual([
			"nudge:2026-08-09",
		]);
	});

	test("counts and truncates a long list, plural correct", () => {
		const many = Array.from({ length: 7 }, (_, i) => w(`/q/n${i}.md`, 10 + i));
		const { messages } = buildMessages(
			report({ waiting: many }),
			new Set(),
			NOW,
		);
		expect(messages[0]).toContain("7 posts ready and waiting on you");
		expect(messages[0]).toContain("Oldest is 16 days old");
		expect(messages[0]).toContain("+2 more");
	});

	test("a note with no parseable date never nudges on its own", () => {
		const { messages } = buildMessages(
			report({ waiting: [w("/q/undated.md", null)] }),
			new Set(),
			NOW,
		);
		expect(messages).toEqual([]);
	});
});
