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
		// Pinterest 422'd on the first real ship (2026-07-15): the HLD Pinterest account
		// is too new for 3rd-party API posting. Blotato requires ~2 weeks of manual
		// warmup (1 pin/day, ramping up) or it risks a shadowban. RE-ENABLE ~2026-07-29
		// by deleting this line once the account has been posting manually.
		pinterest:
			"Pinterest is too new for API posting — warm it up manually (~2 weeks, until ~2026-07-29) before re-enabling. Remove pinterest from this note to ship the rest.",
	},
};
