import { describe, expect, test } from "bun:test";
import {
	BANK_TARGET,
	bankShortfall,
	hintPrompt,
	MAX_PER_RUN,
	pickPhotos,
	readHint,
} from "./stock";

const notes = (...statuses: string[]) => statuses.map((status) => ({ status }));

describe("bankShortfall — how empty is the shelf", () => {
	test("an empty queue asks for a full run, not a full target", () => {
		expect(bankShortfall([])).toBe(MAX_PER_RUN);
		expect(MAX_PER_RUN).toBeLessThan(BANK_TARGET);
	});

	test("a stocked shelf asks for nothing", () => {
		expect(bankShortfall(notes(...Array(BANK_TARGET).fill("pending")))).toBe(0);
	});

	test("never negative when the shelf is over target", () => {
		expect(bankShortfall(notes(...Array(40).fill("pending")))).toBe(0);
	});

	// The distinction the whole file turns on: a post that is already spoken for is
	// not inventory. Counting them would let a week of scheduled posts read as a full
	// shelf and stop production exactly when the queue is about to empty itself.
	test("scheduled, published and in-flight posts are NOT on the shelf", () => {
		expect(
			bankShortfall(
				notes("scheduled", "published", "scheduling", "needs-review"),
				4,
			),
		).toBe(4);
	});

	test("a note with no status yet still counts as pending inventory", () => {
		expect(bankShortfall(notes("", "pending"), 3)).toBe(1);
	});
});

describe("pickPhotos — work the library through once", () => {
	const lib = ["c.png", "a.png", "b.png"];

	test("takes the next unused, in filename order", () => {
		expect(pickPhotos(lib, [], 2)).toEqual(["a.png", "b.png"]);
	});

	test("skips what has already been posted", () => {
		expect(pickPhotos(lib, ["a.png", "b.png"], 2)).toEqual(["c.png"]);
	});

	test("an exhausted library yields nothing rather than repeating", () => {
		expect(pickPhotos(lib, lib, 3)).toEqual([]);
	});

	test("asking for nothing does nothing", () => {
		expect(pickPhotos(lib, [], 0)).toEqual([]);
	});
});

describe("readHint — a brief, or nothing", () => {
	test("takes a one-line brief and strips stray quotes", () => {
		expect(readHint('"A rawhide leatherette 5x7 frame, hand-engraved."')).toBe(
			"A rawhide leatherette 5x7 frame, hand-engraved.",
		);
	});

	// The model is told to bail on a logo or a mockup sheet. Honouring that is what
	// keeps a screenshot out of the queue as a product post.
	test("SKIP means skip", () => {
		expect(readHint("SKIP")).toBeNull();
		expect(readHint("  skip  ")).toBeNull();
	});

	test("an empty or too-short answer is not a brief", () => {
		expect(readHint("")).toBeNull();
		expect(readHint("a mug")).toBeNull();
	});

	test("keeps only the first line when the model adds commentary", () => {
		expect(readHint("A birch baby plaque, engraved.\n\nLet me know!")).toBe(
			"A birch baby plaque, engraved.",
		);
	});
});

describe("hintPrompt", () => {
	test("names the file and forbids guessing", () => {
		const p = hintPrompt("/x/IMG_1.png");
		expect(p).toContain("/x/IMG_1.png");
		expect(p).toContain("Only describe what you can actually see");
		expect(p).toContain("SKIP");
	});
});
