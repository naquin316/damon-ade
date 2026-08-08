import type { TargetDefaults } from "./queue";

/**
 * Per-platform target ids Blotato needs but the account listing does NOT provide.
 *
 * Blotato's `/users/me/accounts` returns only `{id, platform, username, fullname}` for
 * facebook and pinterest — no page id, no board id — yet the publish API requires
 * `pageId` for a facebook Page post and `boardId` for a pinterest pin. Without these,
 * `classify` correctly blocks (`no-page-id` / `no-board-id`) and nothing ships to
 * those two platforms.
 *
 * These are Hand Lane Designs' stable account targets (Ryan-supplied 2026-07-15).
 * Neither is a secret — a Facebook Page id is public (it's in the page's graph/URL)
 * and a Pinterest board id is semi-public — so they live in code as config, not in the
 * 1Password secret pipeline. A note may still override them with its own
 * `pageId:` / `boardId:` field.
 */
export const TARGET_DEFAULTS: TargetDefaults = {
	// facebook.com/Hand Lane Designs page
	facebookPageId: "100587251684586",
	// pinterest board Ryan wants HLD pins to land on (kept for when pinterest is
	// re-enabled below)
	pinterestBoardId: "718535384238926608",
	unavailable: {
		// Pinterest 422'd on the first real ship (2026-07-15), and STILL 422s —
		// re-tested live 2026-08-08 by scheduling a probe pin 30 days out (it was
		// rejected at create time, so nothing had to be cleaned up).
		//
		// THE GATE IS NOT A DATE. The original comment said "RE-ENABLE ~2026-07-29",
		// which came and went with nothing changed on the account, because the clock
		// was never the condition. Blotato's own 422 body spells out the real one:
		//   1. post ~1 pin/day MANUALLY, ramping to 2-3/day, for at least 2 weeks
		//   2. reach 100+ monthly views on the account
		//   3. RECONNECT the Pinterest account in Blotato  <- the step nobody wrote down
		// Skipping the warmup risks a Pinterest shadowban, which is why this blocks
		// before any send rather than letting a multi-platform note half-ship.
		//
		// To re-enable: re-run the probe (schedule a pin, expect 2xx not 422). Delete
		// this entry only after it passes — not because time has passed.
		pinterest:
			"Pinterest still rejects 3rd-party API posting (verified 2026-08-08): the account needs manual warmup (~1 pin/day for 2 weeks), 100+ monthly views, and then a RECONNECT in Blotato. Remove pinterest from this note to ship the rest.",
	},
};
