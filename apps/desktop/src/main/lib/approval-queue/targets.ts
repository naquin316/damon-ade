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
	// pinterest board Ryan wants HLD pins to land on
	pinterestBoardId: "718535384238926608",
};
