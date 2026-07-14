import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

// Every dispatchable agent needs the handoff RECEIVE skill, or a dispatched
// run can never process its inbox note (run hangs until the node timeout).
// `conductor` is excluded: it's dispatched to WRITE plans, not via handoffs —
// it never receives an inbox note.
const SEED_BRAINS_ROOT = join(
	import.meta.dir,
	"../../../../../..",
	"assets",
	"seed-brains",
);

test("every dispatchable agent (capabilities.yaml, except conductor) has a handoff RECEIVE skill", () => {
	const slugs = readdirSync(SEED_BRAINS_ROOT, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.filter((slug) => existsSync(join(SEED_BRAINS_ROOT, slug, "capabilities.yaml")))
		.filter((slug) => slug !== "conductor");

	expect(slugs.length).toBeGreaterThan(0);

	const missing = slugs.filter(
		(slug) =>
			!existsSync(join(SEED_BRAINS_ROOT, slug, "brain/skills/handoff/SKILL.md")),
	);
	expect(missing).toEqual([]);
});
