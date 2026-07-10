import { describe, expect, test } from "bun:test";
import { renderBuildInfoModule } from "./gen-build-info";

describe("renderBuildInfoModule", () => {
	test("emits a valid module with all fields", () => {
		const out = renderBuildInfoModule({
			version: "0.2.0",
			commit: "535fa20",
			commitFull: "535fa20abc",
			branch: "main",
			buildDate: "2026-07-10",
			tag: "v0.2.0",
		});
		expect(out).toContain('version: "0.2.0"');
		expect(out).toContain('commit: "535fa20"');
		expect(out).toContain('commitFull: "535fa20abc"');
		expect(out).toContain('branch: "main"');
		expect(out).toContain('buildDate: "2026-07-10"');
		expect(out).toContain('tag: "v0.2.0"');
		expect(out).toContain("export const BUILD_INFO");
		expect(out).toContain("machine-generated");
	});

	test("escapes are unnecessary but quotes are balanced", () => {
		const out = renderBuildInfoModule({
			version: "0.2.0",
			commit: "a",
			commitFull: "a",
			branch: "b",
			buildDate: "",
			tag: "",
		});
		expect((out.match(/"/g) ?? []).length % 2).toBe(0);
	});
});
