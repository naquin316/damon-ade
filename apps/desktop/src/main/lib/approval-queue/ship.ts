import type { BlotatoAccount, PostStatus } from "./blotato";
import {
	classify,
	type PlannedPost,
	readNote,
	resolveScheduledTime,
	type TargetDefaults,
	withStatus,
} from "./queue";

/**
 * Effectful half of the Approval Queue consumer (RYA-166).
 *
 * Every effect is injected, so the two invariants that actually matter — never
 * approve, never double-post — are provable in a unit test rather than discovered
 * on a live brand account.
 */

export interface DrainDeps {
	/** Absolute paths of every `.md` in the Approval Queue. */
	listNotes(): string[];
	read(path: string): string;
	write(path: string, content: string): void;
	/** platform -> connected Blotato account. */
	connected: Map<string, BlotatoAccount>;
	/** Per-platform target ids Blotato's account listing omits (facebook page,
	 *  pinterest board). Optional — absent means those platforms block until set. */
	targetDefaults?: TargetDefaults;
	/** Send one post. Returns Blotato's post id. */
	send(post: PlannedPost, scheduledTime: string): Promise<{ id: string }>;
	/** Poll a booked post's outcome (published/failed/in-flight) + its live URL.
	 *  Optional — absent means the drain skips post-publish confirmation and leaves
	 *  fired notes at `scheduled`. */
	getPostStatus?(id: string): Promise<PostStatus>;
	now(): number;
}

export interface DrainReport {
	/** Candidates — populated on dry runs too, with the exact text that would go out. */
	shippable: { file: string; posts: PlannedPost[]; scheduledTime: string }[];
	/** Actually claimed + sent. Empty unless `ship` is set. */
	shipped: { file: string; ids: string[]; scheduledTime: string }[];
	/** Confirmed live this run — a scheduled note whose posts all report `published`. */
	published: { file: string; urls: string[] }[];
	blocked: { file: string; reason: string; detail?: string }[];
	needsReview: { file: string; since: string | null }[];
	claimed: string[];
	untouched: { file: string; status: string }[];
	errors: { file: string; error: string }[];
}

/**
 * One pass over the queue.
 *
 * `ship: false` (the default everywhere except the LaunchAgent) reports what
 * *would* happen and mutates nothing — no claims, no writes, no posts.
 */
export async function drain(
	deps: DrainDeps,
	opts: { ship: boolean },
): Promise<DrainReport> {
	const report: DrainReport = {
		shippable: [],
		shipped: [],
		published: [],
		blocked: [],
		needsReview: [],
		claimed: [],
		untouched: [],
		errors: [],
	};
	const now = deps.now();

	for (const path of deps.listNotes()) {
		try {
			const raw = deps.read(path);
			const note = readNote(path, raw);

			// Post-publish confirmation: a `scheduled` note whose scheduled time has
			// passed gets its booked post ids polled. All `published` -> the terminal
			// `published` status + the live URLs; any `failed` -> needs-review (a post
			// may be partly live). Still-in-flight -> leave it `scheduled`, reconfirm
			// next tick. Only on a real --ship run with a status poller wired.
			if (
				opts.ship &&
				deps.getPostStatus &&
				note.status === "scheduled" &&
				note.postIds.length > 0
			) {
				const firedAt = note.scheduledTime
					? Date.parse(note.scheduledTime)
					: Number.NaN;
				if (Number.isFinite(firedAt) && now >= firedAt) {
					const poll = deps.getPostStatus;
					const statuses = await Promise.all(
						note.postIds.map((id) =>
							poll(id).catch(
								(e): PostStatus => ({
									id,
									// A transient poll error is NOT a publish failure — treat it
									// as in-flight so a network blip can't false-flag needs-review.
									status: e instanceof Error ? "unknown" : "unknown",
								}),
							),
						),
					);
					const allPublished = statuses.every(
						(s) => s.status === "published",
					);
					const anyFailed = statuses.some((s) => s.status === "failed");

					if (allPublished) {
						const urls = statuses
							.map((s) => s.publicUrl)
							.filter((u): u is string => Boolean(u));
						deps.write(
							path,
							withStatus(raw, "published", {
								...(urls.length
									? { published_urls: urls.join(" , ") }
									: {}),
							}),
						);
						report.published.push({ file: path, urls });
						continue;
					}
					if (anyFailed) {
						deps.write(
							path,
							withStatus(raw, "needs-review", {
								needs_review_reason:
									"drain-queue: a scheduled post reports failed at publish time — check Blotato",
							}),
						);
						report.needsReview.push({ file: path, since: null });
						continue;
					}
					// still in flight — fall through; classify returns untouched.
				}
			}

			const c = classify(note, now, deps.connected, deps.targetDefaults);

			switch (c.kind) {
				case "shippable": {
					const scheduledTime = resolveScheduledTime(note, now);
					report.shippable.push({ file: path, posts: c.posts, scheduledTime });
					if (!opts.ship) break;

					// Claim BEFORE sending, and let a failed claim abort the send.
					// Reversing these two is the double-post bug: the post would go out
					// while the note still reads `approved`, so the next cron tick sends
					// it again.
					deps.write(
						path,
						withStatus(raw, "scheduling", {
							scheduling_started: new Date(now).toISOString(),
						}),
					);

					const ids: string[] = [];
					try {
						// Sequential on purpose: a multi-target note (instagram + facebook)
						// that fails on the 2nd platform must not have raced the 1st.
						for (const p of c.posts) {
							const { id } = await deps.send(p, scheduledTime);
							ids.push(id);
						}
					} catch (sendError) {
						// Partial send is exactly the ambiguous state a human must resolve:
						// some platforms may already be live. Never auto-retry.
						const msg =
							sendError instanceof Error
								? sendError.message
								: String(sendError);
						deps.write(
							path,
							withStatus(raw, "needs-review", {
								needs_review_reason:
									`drain-queue: send failed after ${ids.length}/${c.posts.length} post(s) — check Blotato before re-approving. ${msg}`.replace(
										/\s+/g,
										" ",
									),
								...(ids.length ? { blotato_post_ids: ids.join(",") } : {}),
							}),
						);
						report.needsReview.push({ file: path, since: null });
						report.errors.push({ file: path, error: msg });
						break;
					}

					deps.write(
						path,
						withStatus(raw, "scheduled", {
							blotato_post_ids: ids.join(","),
							scheduled_time: scheduledTime,
						}),
					);
					report.shipped.push({ file: path, ids, scheduledTime });
					break;
				}

				case "blocked":
					// Left `approved` and untouched on purpose: fix the gap (attach media,
					// connect the account), re-run, and it ships with no second approval.
					report.blocked.push({
						file: path,
						reason: c.reason,
						detail: c.detail,
					});
					break;

				case "needs-review": {
					report.needsReview.push({ file: path, since: c.since });
					if (!opts.ship) break;
					// Park it. Writing `needs-review` also makes this terminal — the next
					// tick classifies it as untouched instead of re-parking it.
					deps.write(
						path,
						withStatus(raw, "needs-review", {
							needs_review_reason:
								"drain-queue: claim went stale with no result; check Blotato before re-approving",
						}),
					);
					break;
				}

				case "claimed":
					report.claimed.push(path);
					break;

				case "untouched":
					report.untouched.push({ file: path, status: c.status });
					break;
			}
		} catch (error) {
			// One unreadable note must not stop the queue draining.
			report.errors.push({
				file: path,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return report;
}

const base = (p: string) => p.split("/").pop() ?? p;

/** Human-readable one-screen summary. Nothing-to-do is the common case, so it has
 *  to be quiet and unmistakable. */
export function formatReport(
	report: DrainReport,
	opts: { ship: boolean; at: string },
): string {
	const L: string[] = [
		`Approval Queue drain — ${opts.at}${opts.ship ? "" : "  [DRY RUN]"}`,
	];
	const n = (x: number) => String(x).padStart(2);

	const counts = report.untouched.reduce<Record<string, number>>((acc, u) => {
		acc[u.status] = (acc[u.status] ?? 0) + 1;
		return acc;
	}, {});
	const untouchedDetail = Object.entries(counts)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([s, c]) => `${c} ${s}`)
		.join(", ");

	if (opts.ship) {
		L.push(`  shipped       ${n(report.shipped.length)}`);
		for (const s of report.shipped) {
			L.push(
				`                   ${base(s.file)} -> ${s.ids.join(", ")} @ ${s.scheduledTime}`,
			);
		}
	} else {
		L.push(`  would ship    ${n(report.shippable.length)}`);
		for (const s of report.shippable) {
			L.push(`                   ${base(s.file)} @ ${s.scheduledTime}`);
			for (const p of s.posts) {
				L.push(
					`                     -> ${p.platform} (account ${p.accountId})${p.mediaUrls.length ? " +media" : ""}`,
				);
			}
		}
	}

	if (report.published.length) {
		L.push(`  published     ${n(report.published.length)}`);
		for (const p of report.published)
			L.push(
				`                   ${base(p.file)}${p.urls.length ? ` -> ${p.urls.join(", ")}` : ""}`,
			);
	}

	L.push(`  blocked       ${n(report.blocked.length)}`);
	for (const b of report.blocked) {
		L.push(
			`                   ${base(b.file)}  (${b.reason}${b.detail ? `: ${b.detail}` : ""})`,
		);
	}

	L.push(`  needs-review  ${n(report.needsReview.length)}`);
	for (const r of report.needsReview)
		L.push(`                   ${base(r.file)}`);

	if (report.claimed.length)
		L.push(`  in flight     ${n(report.claimed.length)}`);
	L.push(
		`  untouched     ${n(report.untouched.length)}${untouchedDetail ? `  (${untouchedDetail})` : ""}`,
	);

	if (report.errors.length) {
		L.push(`  errors        ${n(report.errors.length)}`);
		for (const e of report.errors)
			L.push(`                   ${base(e.file)}: ${e.error}`);
	}
	return L.join("\n");
}

/** The exact text that would be published, for eyeballing before --ship. The copy is
 *  lifted out of the note body by a regex, so it must stay reviewable rather than
 *  trusted. */
export function formatCopyPreview(report: DrainReport): string {
	if (!report.shippable.length) return "";
	const L: string[] = ["", "── copy that would be published ──"];
	for (const s of report.shippable) {
		for (const p of s.posts) {
			L.push("", `┌─ ${base(s.file)} → ${p.platform}`);
			for (const line of p.text.split("\n")) L.push(`│ ${line}`);
			if (p.mediaUrls.length) L.push(`│ [media] ${p.mediaUrls.join(", ")}`);
			L.push("└─");
		}
	}
	return L.join("\n");
}
