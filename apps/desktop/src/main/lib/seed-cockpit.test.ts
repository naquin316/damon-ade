import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projects, workspaces, worktrees } from "@superset/local-db";
import { v4 as uuidv4 } from "uuid";

// Route agent-home path helpers under a throwaway home BEFORE importing anything.
const TEST_HOME = join(tmpdir(), `ade-seed-test-${process.pid}-${Date.now()}`);
process.env.ADE_HOME_DIR = TEST_HOME;

// Point the seed roster at a sandbox instead of Ryan's real ~/Code checkouts
// and vault. seed-cockpit's resolveSource() downgrades any linked-worktree
// whose repoPath doesn't exist on disk to a plain `init` agent, so without
// this override the "linked-worktree" and "direct" assertions below would
// only pass on a machine that happens to have those real repos/vault
// checked out. Only create the repos the "linked-worktree" roster entries
// reference (ShopifyStore, handlaneultimate, rubypulse, hld-admin,
// kalshi-btc-lab, .codehq) — see buildSeedTeams() in seed-cockpit.ts.
const TEST_CODE_ROOT = join(TEST_HOME, "Code");
const TEST_VAULT = join(TEST_HOME, "vault");
process.env.ADE_SEED_CODE_ROOT = TEST_CODE_ROOT;
process.env.ADE_SEED_VAULT = TEST_VAULT;
for (const repo of ["ShopifyStore", "handlaneultimate", "rubypulse", "hld-admin", "kalshi-btc-lab", ".codehq"]) {
	mkdirSync(join(TEST_CODE_ROOT, repo), { recursive: true });
}
mkdirSync(TEST_VAULT, { recursive: true });

/**
 * bunfig.toml's [test] preload (test-setup.ts) globally mocks both
 * "main/lib/local-db" and "@superset/local-db" for every test file, because
 * better-sqlite3's native binding does not load under Bun's test runtime
 * (confirmed: "'better-sqlite3' is not yet supported in Bun", ERR_DLOPEN_FAILED).
 * The global mock returns a fixed { id: "test-id" } on every insert and [] on
 * every select, so a real DB roundtrip is not possible here. Instead — mirroring
 * the mock.module("./local-db", ...) pattern already used in
 * agent-scaffold.test.ts's backfillAgentMemory/resolveAgentWorktreePath blocks —
 * this test installs its own in-memory relational fake so seedDefaultCockpit's
 * insert/select logic (row shapes, generated ids, idempotency) is genuinely
 * exercised rather than trivially satisfied by the dumb default mock.
 */
type FakeTable = "projects" | "workspaces" | "worktrees";
const store: Record<FakeTable, Array<Record<string, unknown>>> = {
	projects: [],
	workspaces: [],
	worktrees: [],
};

function tableName(table: unknown): FakeTable {
	if (table === projects) return "projects";
	if (table === workspaces) return "workspaces";
	if (table === worktrees) return "worktrees";
	throw new Error("fake local-db: unrecognized table reference");
}

const fakeLocalDb = {
	select: () => ({
		from: (table: unknown) => ({
			all: () => store[tableName(table)].slice(),
		}),
	}),
	insert: (table: unknown) => ({
		values: (values: Record<string, unknown>) => {
			const row = { id: uuidv4(), ...values };
			return {
				returning: () => ({
					get: () => {
						store[tableName(table)].push(row);
						return row;
					},
				}),
				run: () => {
					store[tableName(table)].push(row);
				},
			};
		},
	}),
};

let seedDefaultCockpit: typeof import("./seed-cockpit").seedDefaultCockpit;
let localDb: typeof fakeLocalDb;

beforeAll(async () => {
	mock.module("./local-db", () => ({ localDb: fakeLocalDb }));
	localDb = (await import("./local-db")).localDb as typeof fakeLocalDb;
	seedDefaultCockpit = (await import("./seed-cockpit")).seedDefaultCockpit;
});

afterAll(() => rmSync(TEST_HOME, { recursive: true, force: true }));

describe("seedDefaultCockpit", () => {
	// Captured from the first (empty-DB) seed call — later calls are no-ops
	// (idempotent), so subsequent tests read from this instead of re-seeding.
	let firstSeed: ReturnType<typeof seedDefaultCockpit>;

	it("seeds 6 teams and 12 agents into an empty DB", () => {
		firstSeed = seedDefaultCockpit();
		expect(firstSeed.length).toBe(12);
		expect(localDb.select().from(projects).all().length).toBe(6);
		expect(localDb.select().from(workspaces).all().length).toBe(12);
		expect(localDb.select().from(worktrees).all().length).toBe(12);
	});

	it("gives every seeded agent the claude runtime and a worktree", () => {
		const rows = localDb.select().from(workspaces).all();
		expect(rows.every((w) => w.runtime === "claude")).toBe(true);
		expect(rows.every((w) => w.worktreeId != null)).toBe(true);
	});

	it("adds Foreman under HLD Ops as a linked-worktree agent", () => {
		const rows = localDb.select().from(workspaces).all();
		const foreman = rows.find((w) => String(w.name).includes("Foreman"));
		expect(foreman).toBeDefined();
	});

	it("gives a linked-worktree agent its repoPath/branch source", () => {
		const linked = firstSeed.find(
			(a) => a.ctx.source.type === "linked-worktree",
		);
		expect(linked).toBeDefined();
		if (linked && linked.ctx.source.type === "linked-worktree") {
			expect(linked.ctx.source.repoPath.length).toBeGreaterThan(0);
			expect(linked.ctx.source.branch.length).toBeGreaterThan(0);
		}
	});

	it("gives a direct agent its path source", () => {
		const direct = firstSeed.find((a) => a.ctx.source.type === "direct");
		expect(direct).toBeDefined();
		if (direct && direct.ctx.source.type === "direct") {
			expect(direct.ctx.source.path.length).toBeGreaterThan(0);
		}
	});

	it("is idempotent — re-seeding a populated DB is a no-op", () => {
		const again = seedDefaultCockpit();
		expect(again.length).toBe(0);
		expect(localDb.select().from(projects).all().length).toBe(6);
		expect(localDb.select().from(workspaces).all().length).toBe(12);
	});
});
