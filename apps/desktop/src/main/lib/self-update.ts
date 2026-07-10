import { execFile, spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { EventEmitter } from "node:events";
import { app } from "electron";
import { getSupersetHomeDir } from "main/lib/app-environment";
import { BUILD_INFO } from "shared/build-info.generated";
import {
	SELF_UPDATE_STATUS,
	type SelfUpdateEvent,
	deriveUpdateState,
} from "shared/self-update";

const execFileP = promisify(execFile);
const COMPARE_REPO = "naquin316/damon-ade";
const DEFAULT_REPO = join(homedir(), "Code", "damon-ade");

export const selfUpdateEmitter = new EventEmitter();

let current: SelfUpdateEvent = { status: SELF_UPDATE_STATUS.IDLE };

function emit(event: SelfUpdateEvent): void {
	current = event;
	selfUpdateEmitter.emit("status-changed", event);
}

export function getSelfUpdateStatus(): SelfUpdateEvent {
	return current;
}

/** Pure: resolve the configured repo path string (expand ~, default). */
export function readConfiguredRepoPath(raw: string | undefined): string {
	const v = (raw ?? "").trim();
	if (!v) return DEFAULT_REPO;
	if (v === "~") return homedir();
	if (v.startsWith("~/")) return join(homedir(), v.slice(2));
	return v;
}

function configPath(): string {
	return join(getSupersetHomeDir(), "self-update.json");
}

export function resolveRepoPath(): string {
	try {
		const p = configPath();
		if (!existsSync(p)) return DEFAULT_REPO;
		const parsed = JSON.parse(readFileSync(p, "utf8")) as { repoPath?: string };
		return readConfiguredRepoPath(parsed.repoPath);
	} catch {
		return DEFAULT_REPO;
	}
}

function failureMarkerPath(): string {
	return join(getSupersetHomeDir(), "update.failed");
}

/** Read + delete the failure marker (one-shot). Returns the reason or null. */
export function consumeFailureMarker(): string | null {
	const p = failureMarkerPath();
	if (!existsSync(p)) return null;
	try {
		const reason = readFileSync(p, "utf8").trim();
		rmSync(p, { force: true });
		return reason || "Update failed.";
	} catch {
		return null;
	}
}

async function git(repo: string, args: string[]): Promise<string> {
	const { stdout } = await execFileP("git", ["-C", repo, ...args]);
	return stdout.trim();
}

export async function checkForUpdates(): Promise<void> {
	const repo = resolveRepoPath();
	if (!existsSync(join(repo, ".git"))) {
		emit({ status: SELF_UPDATE_STATUS.ERROR, error: `Repo not found at ${repo}` });
		return;
	}
	emit({ status: SELF_UPDATE_STATUS.CHECKING });
	try {
		await git(repo, ["fetch", "origin", "main"]);
		const origin = await git(repo, ["rev-parse", "origin/main"]);
		const installed = BUILD_INFO.commitFull;
		let behind = 0;
		if (installed && installed !== "dev") {
			const out = await git(repo, [
				"rev-list",
				"--count",
				`${installed}..origin/main`,
			]);
			behind = Number.parseInt(out, 10) || 0;
		}
		const state = deriveUpdateState(installed, origin, behind);
		if (state.status === SELF_UPDATE_STATUS.BEHIND) {
			state.compareUrl = `https://github.com/${COMPARE_REPO}/compare/${
				installed && installed !== "dev" ? installed : "main"
			}...main`;
		}
		emit(state);
	} catch (error) {
		// Network/transient: fall back to idle rather than alarming the user.
		const message = error instanceof Error ? error.message : String(error);
		if (
			/could not resolve host|network|timed out|ENOTFOUND|ETIMEDOUT/i.test(
				message,
			)
		) {
			emit({ status: SELF_UPDATE_STATUS.IDLE });
			return;
		}
		emit({ status: SELF_UPDATE_STATUS.ERROR, error: message });
	}
}

export function startUpdate(): void {
	const repo = resolveRepoPath();
	const script = join(repo, "apps/desktop/scripts/self-update.sh");
	if (!existsSync(script)) {
		emit({
			status: SELF_UPDATE_STATUS.ERROR,
			error: `Updater script missing: ${script}`,
		});
		return;
	}
	const home = getSupersetHomeDir();
	mkdirSync(home, { recursive: true });
	// Intent marker (informational; script also writes its own log).
	writeFileSync(join(home, "update.intent"), new Date().toISOString(), "utf8");
	emit({ status: SELF_UPDATE_STATUS.UPDATING });

	const child = spawn(
		"/bin/bash",
		[
			script,
			"--repo",
			repo,
			"--app",
			"/Applications/RyanOS.app",
			"--pid",
			String(process.pid),
		],
		{ detached: true, stdio: "ignore" },
	);
	child.unref();

	// Give the detached child a beat to start, then quit so it can swap our bundle.
	setTimeout(() => app.quit(), 600);
}

export function setupSelfUpdate(): void {
	// Surface a prior failed update once.
	const failure = consumeFailureMarker();
	if (failure) {
		emit({ status: SELF_UPDATE_STATUS.ERROR, error: failure });
	}
	// Check on launch (best-effort; never throws into boot).
	void checkForUpdates().catch(() => {});
}
