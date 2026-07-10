import { describe, expect, test } from "bun:test";
import { SELF_UPDATE_STATUS } from "shared/self-update";
import { formatBadgeLabel } from "./format";

const info = {
	version: "0.2.0",
	commit: "535fa20",
	commitFull: "535fa20",
	branch: "main",
	buildDate: "2026-07-10",
	tag: "v0.2.0",
};

describe("formatBadgeLabel", () => {
	test("idle shows version + commit", () => {
		expect(formatBadgeLabel(info, { status: SELF_UPDATE_STATUS.IDLE })).toBe(
			"v0.2.0 · 535fa20",
		);
	});
	test("behind with count", () => {
		expect(
			formatBadgeLabel(info, {
				status: SELF_UPDATE_STATUS.BEHIND,
				behindCount: 3,
			}),
		).toBe("v0.2.0 · 535fa20 · ↑ 3 behind");
	});
	test("behind with unknown count", () => {
		expect(
			formatBadgeLabel(info, { status: SELF_UPDATE_STATUS.BEHIND }),
		).toBe("v0.2.0 · 535fa20 · ↑ update");
	});
	test("checking", () => {
		expect(
			formatBadgeLabel(info, { status: SELF_UPDATE_STATUS.CHECKING }),
		).toBe("v0.2.0 · 535fa20 · checking…");
	});
	test("updating", () => {
		expect(
			formatBadgeLabel(info, { status: SELF_UPDATE_STATUS.UPDATING }),
		).toBe("v0.2.0 · updating…");
	});
});
