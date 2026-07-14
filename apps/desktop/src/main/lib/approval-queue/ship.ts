import { classify, readNote, withStatus } from "./queue";

/**
 * Effectful half of the Approval Queue consumer (RYA-166).
 *
 * Every effect is injected, so the two invariants that actually matter — never
 * approve, never double-post — are provable in a unit test rather than
 * discovered on a live brand account.
 */

export interface ShipTarget {
	file: string;
	targets: string[];
	media: string | null;
}

export interface DrainDeps {
	/** Absolute paths of every `.md` in the Approval Queue. */
	listNotes(): string[];
	read(path: string): string;
	write(path: string, content: string): void;
	/** Hand a claimed note to post-scheduler (headless `claude -p`). */
	dispatch(target: ShipTarget): void;
	now(): number;
}

export interface DrainReport {
	/** Candidates — populated on dry runs too. */
	shippable: string[];
	/** Actually claimed + dispatched. Empty unless `ship` is set. */
	shipped: string[];
	blocked: { file: string; reason: string }[];
	needsReview: { file: string; since: string | null }[];
	claimed: string[];
	untouched: { file: string; status: string }[];
	errors: { file: string; error: string }[];
}

/**
 * One pass over the queue.
 *
 * `ship: false` (the default everywhere except the LaunchAgent) reports what
 * *would* happen and mutates nothing — no claims, no dispatches, no writes.
 */
export function drain(deps: DrainDeps, opts: { ship: boolean }): DrainReport {
	const report: DrainReport = {
		shippable: [],
		shipped: [],
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
			const c = classify(readNote(path, raw), now);

			switch (c.kind) {
				case "shippable": {
					report.shippable.push(path);
					if (!opts.ship) break;
					// Claim BEFORE dispatch, and let a failed claim abort the dispatch.
					// Reversing these two lines is the double-post bug: the shipper would
					// be running while the note still reads `approved`, so the next cron
					// tick picks it up and posts it again.
					deps.write(
						path,
						withStatus(raw, "scheduling", {
							scheduling_started: new Date(now).toISOString(),
						}),
					);
					deps.dispatch({ file: path, targets: c.targets, media: c.media });
					report.shipped.push(path);
					break;
				}

				case "blocked":
					// Left `approved` and untouched on purpose: attach media, re-run, and
					// it ships with no second approval.
					report.blocked.push({ file: path, reason: c.reason });
					break;

				case "needs-review": {
					report.needsReview.push({ file: path, since: c.since });
					if (!opts.ship) break;
					// Park it. A stale claim is ambiguous (died before or after the post
					// went out) and the side effect is public and irreversible, so a human
					// checks Blotato. Writing `needs-review` also makes this terminal —
					// the next tick classifies it as untouched instead of re-parking it.
					deps.write(
						path,
						withStatus(raw, "needs-review", {
							needs_review_reason:
								"drain-queue: shipper did not report back; check Blotato before re-approving",
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

/** Human-readable one-screen summary. Nothing-to-do is the common case, so it
 *  has to be quiet and unmistakable. */
export function formatReport(
	report: DrainReport,
	opts: { ship: boolean; at: string },
): string {
	const lines: string[] = [
		`Approval Queue drain — ${opts.at}${opts.ship ? "" : "  [DRY RUN]"}`,
	];
	const counts = report.untouched.reduce<Record<string, number>>((acc, u) => {
		acc[u.status] = (acc[u.status] ?? 0) + 1;
		return acc;
	}, {});
	const untouchedDetail = Object.entries(counts)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([s, n]) => `${n} ${s}`)
		.join(", ");

	const base = (p: string) => p.split("/").pop() ?? p;

	if (opts.ship)
		lines.push(`  shipped       ${String(report.shipped.length).padStart(2)}`);
	else
		lines.push(
			`  would ship    ${String(report.shippable.length).padStart(2)}`,
		);
	for (const f of opts.ship ? report.shipped : report.shippable)
		lines.push(`                   ${base(f)}`);

	lines.push(`  blocked       ${String(report.blocked.length).padStart(2)}`);
	for (const b of report.blocked)
		lines.push(`                   ${base(b.file)}  (${b.reason})`);

	lines.push(
		`  needs-review  ${String(report.needsReview.length).padStart(2)}`,
	);
	for (const n of report.needsReview)
		lines.push(`                   ${base(n.file)}`);

	if (report.claimed.length)
		lines.push(`  in flight     ${String(report.claimed.length).padStart(2)}`);
	lines.push(
		`  untouched     ${String(report.untouched.length).padStart(2)}${untouchedDetail ? `  (${untouchedDetail})` : ""}`,
	);

	if (report.errors.length) {
		lines.push(`  errors        ${String(report.errors.length).padStart(2)}`);
		for (const e of report.errors)
			lines.push(`                   ${base(e.file)}: ${e.error}`);
	}
	return lines.join("\n");
}
