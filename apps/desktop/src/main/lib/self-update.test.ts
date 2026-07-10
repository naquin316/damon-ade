import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { readConfiguredRepoPath } from "./self-update";

describe("readConfiguredRepoPath", () => {
	test("defaults to ~/Code/damon-ade when config missing/blank", () => {
		expect(readConfiguredRepoPath(undefined)).toBe(
			join(homedir(), "Code", "damon-ade"),
		);
		expect(readConfiguredRepoPath("   ")).toBe(
			join(homedir(), "Code", "damon-ade"),
		);
	});

	test("expands a leading ~", () => {
		expect(readConfiguredRepoPath("~/Code/damon-ade")).toBe(
			join(homedir(), "Code", "damon-ade"),
		);
	});

	test("passes absolute paths through", () => {
		expect(readConfiguredRepoPath("/Users/x/Code/damon-ade")).toBe(
			"/Users/x/Code/damon-ade",
		);
	});
});
