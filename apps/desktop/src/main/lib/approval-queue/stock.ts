/**
 * Stock the queue — the PRODUCER the pipeline never had.
 *
 * Everything else in this directory is reactive: a door turns something Ryan hands
 * over into a draft, and the drain ships what he approves. Nothing ever *starts* a
 * post. So the queue only ever held what a person put there, and on 2026-08-09 the
 * only reason it held 15 notes was that a campaign had been hand-built into it that
 * afternoon. "The pipeline is healthy and idle" was true for three weeks.
 *
 * This is the missing half: once a week, if the bank of approvable posts is below
 * target, shop the product-photo library for pictures that have never been posted,
 * describe each one, and run it through the SAME `createDraft` path as every door.
 * Nothing here publishes, and nothing here approves — it only fills the shelf.
 *
 * The pure decisions live in this file (how short is the bank, which photos next);
 * the side effects live in scripts/stock-queue.ts.
 */

import type { QueueNote } from "./queue";

/** How many approvable posts to keep on the shelf. */
export const BANK_TARGET = 10;

/**
 * Hard ceiling per run, independent of the shortfall.
 *
 * A miscounted bank (an empty queue dir, a parse failure across every note) reads as
 * "make BANK_TARGET posts" — and each post is a vision call, a copy call and a
 * Blotato upload. The cap is what makes a wrong answer cheap instead of a runaway.
 */
export const MAX_PER_RUN = 5;

/**
 * Statuses that count as "on the shelf": Ryan can act on these and they are not yet
 * committed anywhere public. Everything else has left the bank — `scheduling` is
 * mid-flight, `scheduled`/`published` are spoken for, `needs-review` is a repair job
 * rather than inventory, and re-stocking because of one would hide it behind fresh
 * drafts.
 */
const IN_BANK = new Set(["pending", "approved", ""]);

/** How many posts this run should make: the gap to target, capped, never negative. */
export function bankShortfall(
	notes: Pick<QueueNote, "status">[],
	target: number = BANK_TARGET,
	cap: number = MAX_PER_RUN,
): number {
	const onShelf = notes.filter((n) => IN_BANK.has(n.status)).length;
	return Math.max(0, Math.min(cap, target - onShelf));
}

/**
 * Choose the next photos to turn into posts.
 *
 * In filename order, skipping anything already used, so the library is worked
 * through exactly once rather than sampled at random — random repeats a favourite
 * and starves the tail, and "have I posted this yet" is the one question a person
 * cannot answer about 216 files.
 */
export function pickPhotos(
	available: string[],
	used: Iterable<string>,
	need: number,
): string[] {
	if (need <= 0) return [];
	const seen = new Set(used);
	return available
		.filter((f) => !seen.has(f))
		.sort((a, b) => a.localeCompare(b))
		.slice(0, need);
}

/**
 * Ask for a one-line product brief from the photo itself.
 *
 * "Only describe what you can actually see" is doing real work: the HLD rubric
 * treats an invented claim as a hard fail, and a hint is the one input the caption
 * writer trusts completely. A hallucinated material or price here becomes a
 * confident lie in the caption, and the voice linter cannot catch a claim that is
 * merely false rather than banned.
 */
export function hintPrompt(imagePath: string): string {
	return `Read the image at "${imagePath}" and reply with ONE line describing this Hand Lane Designs product for a social caption brief: what the item is, its material and colour, and what is engraved on it.

Only describe what you can actually see. Do NOT guess a price, a size in ounces, a brand name, or what it is made of if you cannot tell. If the photo is not a product photo (a logo, a screenshot, a mockup sheet, a person), reply with exactly: SKIP

No preamble, no quotes.`;
}

/** The model's answer to hintPrompt, or null when it declined / gave nothing usable. */
export function readHint(raw: string): string | null {
	const s = raw
		.trim()
		.replace(/^["']|["']$/g, "")
		.trim();
	if (!s || s.toUpperCase().startsWith("SKIP")) return null;
	// A refusal or a preamble is long and multi-line; a brief is one sentence.
	const first = s.split("\n")[0].trim();
	return first.length >= 15 ? first : null;
}
