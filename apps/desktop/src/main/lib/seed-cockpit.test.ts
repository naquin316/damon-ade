import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projects, workspaces, worktrees } from "@superset/local-db";
import { v4 as uuidv4 } from "uuid";

// Route agent-home path helpers under a throwaway home BEFORE importing anything.
const TEST_HOME = join(tmpdir(), `ade-seed-test-${process.pid}-${Date.now()}`);
process.env.ADE_HOME_DIR = TEST_HOME;

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
	it("seeds 5 teams and 10 agents into an empty DB", () => {
		const seeded = seedDefaultCockpit();
		expect(seeded.length).toBe(10);
		expect(localDb.select().from(projects).all().length).toBe(5);
		expect(localDb.select().from(workspaces).all().length).toBe(10);
		expect(localDb.select().from(worktrees).all().length).toBe(10);
	});

	it("gives every seeded agent the claude runtime and a worktree", () => {
		const rows = localDb.select().from(workspaces).all();
		expect(rows.every((w) => w.runtime === "claude")).toBe(true);
		expect(rows.every((w) => w.worktreeId != null)).toBe(true);
	});

	it("is idempotent — re-seeding a populated DB is a no-op", () => {
		const again = seedDefaultCockpit();
		expect(again.length).toBe(0);
		expect(localDb.select().from(projects).all().length).toBe(5);
		expect(localDb.select().from(workspaces).all().length).toBe(10);
	});
});
