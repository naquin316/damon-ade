import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Dashboard } from "shared/mission-control-types";
import { getSupersetHomeDir } from "../app-environment";

export const DEFAULT_DASHBOARDS: Dashboard[] = [
	{ id: "ops-deck", name: "Ops Deck", url: "http://192.168.86.43:8787", kind: "lan" },
	{ id: "rubypulse", name: "RubyPulse", url: "http://192.168.86.28:7420", kind: "lan" },
	{ id: "mypka", name: "myPKA Cockpit", url: "http://localhost:4317", kind: "localhost" },
	{ id: "catchpad", name: "CatchPad", url: "https://catchpad-dash.pages.dev", kind: "web" },
	{ id: "codehq", name: "Code HQ", url: "file:///Users/ryannaquin/Code/dashboard.html", kind: "file" },
];

function configPath(): string {
	return join(getSupersetHomeDir(), "mission-control.json");
}

/** Read the roster; seed the file with defaults if absent; fall back to defaults on any error. */
export function readDashboards(): Dashboard[] {
	const p = configPath();
	try {
		if (!existsSync(p)) {
			writeFileSync(p, `${JSON.stringify(DEFAULT_DASHBOARDS, null, 2)}\n`, "utf8");
			return DEFAULT_DASHBOARDS;
		}
		const parsed = JSON.parse(readFileSync(p, "utf8"));
		return Array.isArray(parsed) && parsed.length > 0 ? (parsed as Dashboard[]) : DEFAULT_DASHBOARDS;
	} catch {
		return DEFAULT_DASHBOARDS;
	}
}
