import { expect, test } from "bun:test";
import { splitFrontmatter, joinFrontmatter } from "./frontmatter";

test("splitFrontmatter(joinFrontmatter(...)) round-trips body and data exactly", () => {
	const data = { a: 1, b: [1, 2] };
	const body = "line1\n\n---\n\nline2\n";
	const joined = joinFrontmatter(data, body);
	const split = splitFrontmatter(joined);
	expect(split.body).toBe(body);
	expect(split.data).toEqual(data);
});

test("splitFrontmatter does not throw on malformed YAML frontmatter", () => {
	const raw = "---\nrun_id: [unterminated\n---\nbody\n";
	const result = splitFrontmatter(raw);
	expect(result.data).toEqual({});
});

test("splitFrontmatter parses a hand-written note with a single newline after closing ---", () => {
	const raw = "---\nhandoff_id: h2\nstatus: done\n---\nbody\n";
	const result = splitFrontmatter(raw);
	expect(result.data).toEqual({ handoff_id: "h2", status: "done" });
	expect(result.body).toBe("body\n");
});
