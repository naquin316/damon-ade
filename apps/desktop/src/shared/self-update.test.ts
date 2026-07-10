import { describe, expect, test } from "bun:test";
import { SELF_UPDATE_STATUS, deriveUpdateState } from "./self-update";

describe("deriveUpdateState", () => {
	test("idle when commits match", () => {
		const e = deriveUpdateState("abc123", "abc123", 0);
		expect(e.status).toBe(SELF_UPDATE_STATUS.IDLE);
		expect(e.behindCount).toBe(0);
	});

	test("behind when origin is ahead", () => {
		const e = deriveUpdateState("abc123", "def456", 3);
		expect(e.status).toBe(SELF_UPDATE_STATUS.BEHIND);
		expect(e.behindCount).toBe(3);
	});

	test("behind with unknown count when installed commit is dev", () => {
		const e = deriveUpdateState("dev", "def456", 0);
		expect(e.status).toBe(SELF_UPDATE_STATUS.BEHIND);
		expect(e.behindCount).toBeUndefined();
	});

	test("idle when different commits but zero behind (already ahead/local)", () => {
		const e = deriveUpdateState("abc123", "def456", 0);
		expect(e.status).toBe(SELF_UPDATE_STATUS.IDLE);
	});
});
