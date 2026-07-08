import { execFileSync } from "node:child_process";
import {
	appendFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { AgentRuntime } from "@superset/local-db";
import {
	getAgentCodexHome,
	getAgentContextDir,
	getAgentHome,
	getAgentMcpPath,
	getAgentMemoryDir,
	getAgentPersonaPath,
	getAgentSettingsPath,
	getAgentSkillsDir,
	getAgentWorktreePath,
} from "./agent-home";

/**
 * Memory scaffold written on agent creation (ADE Phase E, docs/memory.md).
 * Writes the canonical memory/*.md files, the write-back protocol,
 * a skills seed, and the per-runtime bridge files that point each CLI at the
 * canonical memory. Electron-free so it composes with setupAgentRepo and is
 * unit-verifiable. Templates are kept short — they are context on every turn.
 *
 * Faithful to the Hermes agent (github.com/NousResearch/hermes-agent): the
 * self-curation guidance in .writeback-protocol.md is ported from Hermes'
 * `memory` tool description (tools/memory_tool.py MEMORY_SCHEMA), AGENT.md
 * mirrors the short SOUL.md identity, the SKILL.md template follows Hermes'
 * skill-authoring standards (agent/learn_prompt.py), and the session-end
 * reflection is an ADE adaptation of Hermes' post-turn background review
 * (agent/background_review.py). See the spec for the full mapping.
 */

export interface ScaffoldParams {
	agentId: string;
	agentName: string;
	runtime: AgentRuntime;
	/** Human name for USER.md; falls back to "the user". */
	userName?: string;
	/**
	 * Optional role/purpose that seeds AGENT.md's persona section. Blank (the
	 * default flow) leaves an invitation for the agent to define its focus
	 * through conversation. A parallel agent-role-ui surface passes this from
	 * the New Agent modal.
	 */
	role?: string;
	/**
	 * Absolute worktree path the per-runtime bridge files (CLAUDE.md,
	 * .claude/, opencode.json, .git/info/exclude) are written into. Defaults to
	 * the derived <agent-home>/worktree. The local-path creation flow stores an
	 * EXTERNAL repo path on the workspace's worktrees row — for those agents the
	 * caller must pass that path so bridges land in the real repo, not a
	 * derived dir that doesn't exist. Memory/skills always stay under
	 * <agent-home> regardless. Callers should ensure the path exists and is a
	 * git repo before passing it.
	 */
	worktreePath?: string;
	/**
	 * True for a real-repo agent (linked-worktree/direct source): the bridge
	 * lives entirely under the external agent-home (context/CLAUDE.md,
	 * persona.txt, settings.json, mcp.json) and NOTHING ADE-specific is written
	 * into the worktree except a git-excluded .claude/skills symlink. Isolated
	 * init/clone agents (default, false/undefined) keep the legacy in-worktree
	 * bridge (CLAUDE.md, .claude/settings.json, opencode.json).
	 */
	external?: boolean;
	/**
	 * True for `direct`-source agents (Daily Planner, Clip Scout, Script
	 * Writer, ...) whose cwd is a shared REAL directory (e.g. the vault root),
	 * not a dedicated worktree — so it must never be written into or have its
	 * `.git` touched. Skills are namespaced instead under
	 * ~/.claude/skills/ryanos-<agentId> so multiple direct agents sharing one
	 * cwd don't collide on a single `.claude/skills` symlink.
	 */
	directCwd?: boolean;
	/**
	 * Absolute path to an authored brain dir (assets/seed-brains/<slug>/brain,
	 * resolved by getAuthoredBrainDir). When set + populated, persona.txt /
	 * context/CLAUDE.md / mcp.json are sourced from here instead of the in-code
	 * templates, and skills/* are copied in. NEVER touches MEMORY.md. Undefined
	 * (greenfield / unmapped agents) → the generic templates below are used.
	 */
	authoredBrainDir?: string;
}

function sub(
	template: string,
	vars: Record<string, string>,
): string {
	return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

/**
 * Write `content` only if the target is missing or empty. Makes the scaffold
 * idempotent so the launch-time backfill (agent-memory-backfill.ts) can re-run
 * over an existing agent without ever clobbering a canonical file or bridge the
 * user (or the agent) has already filled in. On a fresh agent every file is
 * absent, so this behaves exactly like a plain write.
 */
function writeIfEmpty(path: string, content: string): void {
	if (existsSync(path) && readFileSync(path, "utf8").trim().length > 0) return;
	writeFileSync(path, content, "utf8");
}

/** Read an authored brain file if present + non-empty, else undefined. */
function authoredFile(brainDir: string | undefined, rel: string): string | undefined {
	if (!brainDir) return undefined;
	const p = join(brainDir, rel);
	if (!existsSync(p)) return undefined;
	const body = readFileSync(p, "utf8");
	return body.trim().length > 0 ? body : undefined;
}

/**
 * Append `pattern` (under `marker`, idempotently) to a worktree's SHARED
 * `info/exclude` file, resolved via `git rev-parse --git-common-dir` rather
 * than assumed to be `<worktreePath>/.git/info`. For a `linked-worktree`
 * agent `.git` is a plain FILE (a `gitdir:` pointer, per
 * https://git-scm.com/docs/gitrepository-layout), not a directory —
 * `mkdirSync(join(worktreePath, ".git", "info"))` throws ENOTDIR on a real
 * linked worktree. `info/exclude` lives in and is shared by the repo's
 * common dir across all of its worktrees, so resolving it via
 * --git-common-dir is correct for every repo shape (plain repo, linked
 * worktree, bare repo).
 *
 * Never throws: not a git repo (e.g. a `direct`-mode agent in a plain
 * directory) or any I/O failure is swallowed as best-effort, so a failed
 * exclude write can never block a caller from still creating the
 * `.claude/skills` symlink afterward.
 */
function writeGitExclude(worktreePath: string, marker: string, pattern: string): void {
	let commonDir: string;
	try {
		commonDir = execFileSync(
			"git",
			["-C", worktreePath, "rev-parse", "--git-common-dir"],
			// stderr ignored: "not a git repository" is an expected, handled case
			// (e.g. a `direct`-mode agent in a plain directory), not an error worth
			// surfacing to the console on every scaffold.
			{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
		).trim();
	} catch {
		return; // Not a git repo (or git unavailable) — nothing to exclude.
	}
	try {
		const infoDir = isAbsolute(commonDir)
			? join(commonDir, "info")
			: join(worktreePath, commonDir, "info");
		mkdirSync(infoDir, { recursive: true });
		const excludePath = join(infoDir, "exclude");
		const existing = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : "";
		if (!existing.includes(marker)) {
			appendFileSync(excludePath, `\n${marker}\n${pattern}\n`, "utf8");
		}
	} catch {
		/* best-effort */
	}
}

// AGENT.md is the ADE analog of Hermes' SOUL.md: a short identity that leads the
// context (who you are + voice), followed by an operating brief. Hermes keeps
// SOUL.md to a single prose paragraph — we keep AGENT.md deliberately short too.
// {{role_section}} is built in code from the optional `role` param.
const AGENT_MD = `# {{agent_name}}

You are {{agent_name}}, an autonomous coding agent working in a dedicated git
worktree. You are direct, precise, and prize being genuinely useful over being
verbose. You admit uncertainty, prefer small verifiable changes, and you keep
your own persistent memory (MEMORY.md, USER.md) current as you learn — read it,
trust it, and maintain it per the write-back protocol.

## Role
{{role_section}}

## Operating brief
- Work only within your worktree: {{agent_home}}/worktree
- Prefer small, verifiable changes. Run the project's checks before declaring done.
- When you learn something durable about {{user_name}} or the project, save it to
  memory per the write-back protocol.
- Reusable procedures become skills under {{agent_home}}/skills/, not memory notes.

## Standing preferences
- (none yet — {{user_name}} will add these, or you will learn them)
`;

const USER_MD = `# User profile

- Name: {{user_name}}
- (The agent maintains this file. Add stable facts about the user: role,
  timezone, tech preferences, communication style, hard "always/never" rules.)

## Preferences
- (learned over time)

## Do not
- (pet peeves / things to avoid)
`;

const MEMORY_MD = `# Memory — {{agent_name}}

<!-- Maintain this file per the write-back protocol. One fact per bullet.
     Keep inline notes under ~2,200 chars; offload detail to memory/<topic>.md
     and leave a one-line pointer here. -->

## Environment
- Agent home: {{agent_home}}
- Runtime: {{runtime}}
- Created: {{created_date}}

## Project
- (conventions, build/test commands, architecture notes — learned over time)

## Lessons
- (tool quirks, workarounds, corrections that shouldn't repeat)

## Detail files
- (e.g. \`- debugging → memory/debugging.md\`)
`;

// Ported from Hermes' `memory` tool description (tools/memory_tool.py
// MEMORY_SCHEMA — the "WHEN / TARGETS / SKIP / IF FULL" self-curation guidance)
// and its background-review prompts (agent/background_review.py), adapted to
// file-edit semantics: ADE has no custom memory tool, so the agent edits these
// files with its normal Edit/Write tools. The reflection section is the ADE
// analog of Hermes' post-turn learning loop.
const WRITEBACK_PROTOCOL = `## Your persistent memory — how to maintain it

You have one memory file, loaded into your context at the start of every
session. Memory is injected into every future turn, so keep entries compact and
high-signal — everything here costs tokens forever. The best memory stops
{{user_name}} from having to repeat themselves.

- {{agent_home}}/memory/MEMORY.md — your own notes: learned preferences and
  facts about {{user_name}}, environment facts, project conventions, tool
  quirks, lessons learned, and a short index of any memory/<topic>.md detail
  files. Target < 2,200 chars for the inline notes.

WHEN to save (edit the file with your normal file tools, proactively — don't
wait to be asked):
- the user states a preference, correction, or personal detail  → MEMORY.md
- you learn a stable fact about their environment, stack, conventions, or
  workflow  → MEMORY.md
- a correction would otherwise be repeated next session
Priority when space is tight: user preferences & corrections > environment
facts > procedures.

SKIP: trivial or obvious info, easily re-discovered facts, raw data/log dumps,
task progress, completed-work logs, temporary TODO or debugging state, one-off
paths. Reusable step-by-step procedures belong in a skill (see below), not a
memory entry.

FORMAT: one fact per bullet, present tense, no dates unless load-bearing.
Convert relative dates to absolute. If MEMORY.md's inline notes grow past the
target, move the least-critical section into memory/<topic>.md and leave a
one-line pointer in MEMORY.md.

WHEN FULL: don't just append. Consolidate — merge overlapping bullets, drop the
stalest, then add, all in one edit. A write that only ever grows becomes a
bloated memory that gets ignored; that is the failure mode. Editing is cheap.

Never write secrets, tokens, or anything you wouldn't want replayed into a
future prompt.

## Skills — reusable know-how

A skill is a folder under {{agent_home}}/skills/<name>/ with a SKILL.md
(agentskills.io format). Only its name + one-line description sit in context;
the body loads on demand. Create a skill for any reusable, multi-step procedure
or a class-of-task lesson — NOT for one-off facts (those go in MEMORY.md). When
the user corrects your style, format, or workflow for a kind of task, embed that
correction in the skill that governs that task, so the next session starts
already knowing.

## Session-end reflection

Before you finish a session (or when a substantial piece of work concludes),
review the conversation and update your memory and skills so the next session
starts smarter. Be active: a review that changes nothing is usually a missed
learning opportunity, not a neutral outcome.

1. Memory — did the user reveal a preference, correction, personal detail, or
   expectation about how you should work, or did you learn a stable fact about
   their environment/stack/conventions? Save it to MEMORY.md, per the
   WHEN/SKIP rules above.
2. Skills — if the user corrected your style, tone, format, or workflow, embed
   the lesson in the skill that governs this class of task (create one if none
   exists). If a non-trivial technique, fix, or debugging path emerged, capture
   it. A preference correction belongs in a skill, not only in memory.

Do NOT capture as durable memory or skills (these harden into false constraints
that bite you later when the environment changes):
- environment-dependent failures: missing binaries, "command not found",
  unconfigured credentials, uninstalled packages — the user can fix these.
- negative claims about tools ("X is broken", "can't use Y") — capture the FIX
  instead, under a troubleshooting note.
- transient errors that resolved on retry — the lesson is the retry, not the
  failure.
- one-off task narratives.

If the session produced no durable fact and no correction, that's fine — make no
changes and finish.
`;

const SKILLS_README = `# Skills for {{agent_name}}

Each skill is a folder with a SKILL.md (agentskills.io format). Only the
name + description sit in context; the body loads on demand. Create a skill
for any reusable, multi-step procedure or class-of-task lesson — not for
one-off facts (those go in MEMORY.md). See SKILL.template.md for the frontmatter
and section order to follow.
`;

// SKILL authoring template — mirrors Hermes' skill-authoring standards
// (agent/learn_prompt.py _AUTHORING_STANDARDS) and the shipped SKILL.md files:
// description <=60 chars, version, optional platforms, metadata.<ns>.tags, and
// the canonical body section order. agentskills.io-compatible.
const SKILL_TEMPLATE = `---
name: my-skill
description: One line, <= 60 chars, what this does.
version: 0.1.0
platforms: [macos, linux]
metadata:
  ade:
    tags: [Example]
---

# Skill Title

Two or three sentences: what it does, what it does NOT do, and the key
dependency stance.

## When to Use
- Concrete trigger phrases / conditions.

## Prerequisites
- Exact env vars, install steps, credentials (omit if none).

## Procedure
1. Step one — copy-paste-exact commands.
2. Step two.

## Pitfalls
- Known limits and things that look broken but aren't.

## Verification
A single command or check that proves the skill worked.
`;

const CLAUDE_BRIDGE = `@{{agent_home}}/memory/AGENT.md
@{{agent_home}}/memory/USER.md
<!-- MEMORY.md is loaded via Claude Code native auto-memory (autoMemoryDirectory). -->
`;

// Knowledge doc, loaded via --add-dir. SELF-CONTAINED — no cross-dir @-import
// (those trip Claude Code's external-import trust prompt). The brain-author skill
// (Phase 2B-2) fills these with POINTERS to the vault SSOT + repo docs, not copies.
const CONTEXT_CLAUDE_MD = `# {{agent_name}} — Knowledge

## Domain
- (What this agent must know about its domain. Filled by the brain-author skill;
  point at the single source of truth, do not copy it.)

## Sources of truth
- (e.g. vault notes, repo docs — filled by the brain-author skill.)
`;

// Profile + Contract, injected via --append-system-prompt-file (a system-prompt
// append, NOT an import — never prompts). Kept under ~1K chars. The brain-author
// skill (2B-2) replaces this with an agent-specific persona; this is the default.
const PERSONA_TXT = `You are {{agent_name}}, a specialist agent for {{user_name}}.

## Profile
- Direct, precise, proactive. You prize being genuinely useful over being verbose,
  and you admit uncertainty. (The brain-author skill refines this per agent.)

## Contract
- Work only within your assigned workspace. Prefer small, verifiable changes and
  run the project's checks before declaring done.
- Drive: propose next actions rather than waiting to be told.
- Never write secrets. Never take irreversible or production-affecting actions
  without explicit confirmation. (Per-agent always/never rules filled by 2B-2.)

## Memory
- Keep your persistent memory (MEMORY.md, loaded automatically) current — save
  learned preferences, facts, and lessons there, and turn reusable procedures into
  skills. Do this proactively, not only when asked.
`;

// Claude Code Stop-hook script: the native analog of Hermes' post-turn
// background review (agent/background_review.py). When the agent tries to stop,
// this forces ONE review turn (decision:block feeds `reason` back to the model);
// the stop_hook_active guard means the review turn itself stops cleanly instead
// of looping. Runs under `node` (always present in a Claude Code host); reads
// the hook JSON from stdin (fd 0). Lives in .claude/ (git-excluded) so it never
// enters the repo. See docs/memory.md.
function reflectHookScript(agentHome: string, userName: string): string {
	const reason =
		`[session reflection] Before you finish, review this conversation and update ` +
		`your persistent memory and skills so the next session starts smarter, per the ` +
		`Session-end reflection section of your write-back protocol ` +
		`(${agentHome}/memory/.writeback-protocol.md). Save durable preferences, facts, ` +
		`and lessons about ${userName} to MEMORY.md, and embed any reusable procedure or ` +
		`style/format/workflow correction as a skill under ${agentHome}/skills/. Do NOT ` +
		`capture environment-dependent failures, negative tool claims, transient errors, ` +
		`or one-off narratives. Make the edits with your file tools, then finish. If ` +
		`nothing durable came up, make no changes and stop.`;
	return `#!/usr/bin/env node
// ADE session-reflection hook (Claude Code Stop hook). Native analog of the
// Hermes post-turn review loop. Generated by agent-scaffold.ts; do not edit —
// it is regenerated on scaffold. See docs/memory.md.
import { readFileSync } from "node:fs";
let raw = "";
try { raw = readFileSync(0, "utf8"); } catch {}
let data = {};
try { data = JSON.parse(raw || "{}"); } catch {}
// Already inside the reflection turn we injected — let it stop (no loop).
if (data && data.stop_hook_active) process.exit(0);
const reason = ${JSON.stringify(reason)};
process.stdout.write(JSON.stringify({ decision: "block", reason }));
process.exit(0);
`;
}

/** Bridge files written into the worktree (git-excluded, never committed). */
const BRIDGE_EXCLUDES = ["CLAUDE.md", ".claude/", "opencode.json", "AGENTS.md"];

/**
 * Regenerate <agent-home>/.codex/AGENTS.md from the canonical memory files.
 * Codex cannot @import, so its bridge is the concatenation, rebuilt on each
 * launch (and once at creation). Call this before launching a codex agent.
 */
export function regenerateCodexAgentsMd(agentId: string): void {
	const memoryDir = getAgentMemoryDir(agentId);
	const codexHome = getAgentCodexHome(agentId);
	mkdirSync(codexHome, { recursive: true });

	const parts: string[] = [];
	for (const file of ["AGENT.md", "USER.md", "MEMORY.md", ".writeback-protocol.md"]) {
		const p = join(memoryDir, file);
		if (existsSync(p)) {
			parts.push(readFileSync(p, "utf8"));
		}
	}
	// No canonical memory (e.g. an agent created before the scaffold was
	// enabled): leave any existing bridge untouched rather than clobbering it
	// with an empty file. Codex then falls back to no global AGENTS.md.
	if (parts.length === 0) return;
	writeFileSync(join(codexHome, "AGENTS.md"), parts.join("\n\n"), "utf8");
}

/**
 * Build AGENT.md's "## Role" body from the optional role/purpose string.
 * Provided → the role text verbatim (as a bullet). Blank (default flow) → an
 * invitation for the agent to define its focus through conversation, which
 * matches the user's default of building the persona in-session.
 */
function roleSection(role: string | undefined, userName: string): string {
	const trimmed = role?.trim();
	if (trimmed) return `- ${trimmed}`;
	return (
		`- Not set yet. You and ${userName} will define your focus through\n` +
		`  conversation; once it's clear, write a one-line purpose here and refine\n` +
		`  it over time.`
	);
}

export function scaffoldAgentMemory({
	agentId,
	agentName,
	runtime,
	userName,
	role,
	worktreePath: worktreePathOverride,
	external,
	directCwd,
	authoredBrainDir,
}: ScaffoldParams): void {
	const agentHome = getAgentHome(agentId);
	const memoryDir = getAgentMemoryDir(agentId);
	// Bridges go into the agent's real worktree — which is the external repo path
	// for local-path agents, and the derived <agent-home>/worktree otherwise.
	// Memory/skills stay under <agent-home> either way.
	const worktreePath =
		worktreePathOverride?.trim() || getAgentWorktreePath(agentId);
	const skillsDir = getAgentSkillsDir(agentId);
	const resolvedUserName = userName?.trim() || "the user";

	const vars: Record<string, string> = {
		agent_name: agentName,
		agent_id: agentId,
		agent_home: agentHome,
		user_name: resolvedUserName,
		role_section: roleSection(role, resolvedUserName),
		runtime,
		created_date: new Date().toISOString().slice(0, 10),
	};

	mkdirSync(memoryDir, { recursive: true });
	mkdirSync(skillsDir, { recursive: true });

	// Canonical memory files (source of truth, never committed). Idempotent:
	// a non-empty file the agent/user has already written is preserved.
	writeIfEmpty(join(memoryDir, "AGENT.md"), sub(AGENT_MD, vars));
	writeIfEmpty(join(memoryDir, "USER.md"), sub(USER_MD, vars));
	writeIfEmpty(join(memoryDir, "MEMORY.md"), sub(MEMORY_MD, vars));
	writeIfEmpty(
		join(memoryDir, ".writeback-protocol.md"),
		sub(WRITEBACK_PROTOCOL, vars),
	);
	writeIfEmpty(join(skillsDir, "README.md"), sub(SKILLS_README, vars));
	writeIfEmpty(join(skillsDir, "SKILL.template.md"), sub(SKILL_TEMPLATE, vars));

	// External brain (loaded at launch via flags — never written into the repo).
	// Written for every agent (external or not) since it's the eventual shared
	// launch surface; only the LEGACY in-worktree bridge below is gated on
	// `external` for backward compatibility with isolated init/clone agents.
	const contextDir = getAgentContextDir(agentId);
	mkdirSync(contextDir, { recursive: true });
	const externalReflectHookPath = join(agentHome, "reflect-on-stop.mjs");
	writeIfEmpty(externalReflectHookPath, reflectHookScript(agentHome, resolvedUserName));
	writeIfEmpty(
		join(contextDir, "CLAUDE.md"),
		authoredFile(authoredBrainDir, "context/CLAUDE.md") ?? sub(CONTEXT_CLAUDE_MD, vars),
	);
	writeIfEmpty(
		getAgentPersonaPath(agentId),
		authoredFile(authoredBrainDir, "persona.txt") ?? sub(PERSONA_TXT, vars),
	);
	writeIfEmpty(
		getAgentSettingsPath(agentId),
		`${JSON.stringify(
			{
				autoMemoryDirectory: memoryDir,
				autoMemoryEnabled: true,
				hooks: {
					Stop: [
						{
							matcher: "*",
							hooks: [
								{
									type: "command",
									command: `node ${JSON.stringify(externalReflectHookPath)}`,
									timeout: 120,
								},
							],
						},
					],
				},
			},
			null,
			2,
		)}\n`,
	);
	writeIfEmpty(
		getAgentMcpPath(agentId),
		authoredFile(authoredBrainDir, "mcp.json") ??
			`${JSON.stringify({ mcpServers: {} }, null, 2)}\n`,
	);

	// Authored starter skills: copy each skills/<name>/ that isn't already
	// present. `writeIfEmpty` semantics at the folder level — a learned skill of
	// the same name is never overwritten.
	if (authoredBrainDir) {
		const authoredSkills = join(authoredBrainDir, "skills");
		if (existsSync(authoredSkills)) {
			for (const entry of readdirSync(authoredSkills, { withFileTypes: true })) {
				if (!entry.isDirectory()) continue;
				const dest = join(skillsDir, entry.name);
				if (existsSync(dest)) continue; // never clobber learned skills
				cpSync(join(authoredSkills, entry.name), dest, { recursive: true });
			}
		}
	}

	// Per-agent skills must be discoverable by Claude Code (it can't load skills by
	// flag): symlink <agent-home>/skills into <worktree>/.claude/skills. This is
	// the ONE thing we add to a real (external) worktree; kept out of the repo
	// via the shared .git/info/exclude, never a tracked file.
	//
	// Crash-safety: the exclude entry is written FIRST — and writeGitExclude
	// never throws — so a failure resolving/writing it can never leave an
	// UNPROTECTED symlink dropped into a real repo the user didn't ask to have
	// modified.
	//
	// `claudeDir` is derived unconditionally (just a path join, no I/O) because
	// the legacy `!external` block below also needs it for its Stop-hook script
	// path — that block only runs for non-external agents, which are never
	// `directCwd`, but the variable must still be in scope there.
	const claudeDir = join(worktreePath, ".claude");
	if (directCwd) {
		// Direct agents share a real dir (e.g. the vault) as cwd — never write
		// .claude/skills into it. Give them a namespaced global skills dir instead.
		const globalSkills = join(homedir(), ".claude", "skills", `ryanos-${agentId}`);
		mkdirSync(join(homedir(), ".claude", "skills"), { recursive: true });
		if (!existsSync(globalSkills)) {
			try {
				symlinkSync(skillsDir, globalSkills, "dir");
			} catch {
				/* best-effort */
			}
		}
	} else {
		// Linked/isolated worktree: git-excluded .claude/skills symlink (as today).
		const skillsMarker = "# ADE agent skills symlink (generated, not committed)";
		writeGitExclude(worktreePath, skillsMarker, ".claude/skills");
		mkdirSync(claudeDir, { recursive: true });
		const skillsLink = join(claudeDir, "skills");
		if (!existsSync(skillsLink)) {
			try {
				symlinkSync(skillsDir, skillsLink, "dir");
			} catch {
				/* best-effort */
			}
		}
	}

	// Non-external (isolated init/clone) agents keep the legacy in-worktree
	// bridge for parity with the old behavior. External (real-repo) agents rely
	// entirely on the external brain above and must never have ADE-specific
	// files written into their worktree beyond the skills symlink.
	if (!external) {
		writeIfEmpty(join(worktreePath, "CLAUDE.md"), sub(CLAUDE_BRIDGE, vars));
		// Session-reflection hook script + settings that wire it as a Stop hook and
		// point native auto-memory at the canonical dir. Both are Claude-Code-only
		// surfaces; harmless to the other runtimes.
		const reflectHookPath = join(claudeDir, "reflect-on-stop.mjs");
		writeIfEmpty(reflectHookPath, reflectHookScript(agentHome, resolvedUserName));
		writeIfEmpty(
			join(claudeDir, "settings.json"),
			`${JSON.stringify(
				{
					autoMemoryDirectory: join(memoryDir),
					autoMemoryEnabled: true,
					hooks: {
						Stop: [
							{
								matcher: "*",
								hooks: [
									{
										type: "command",
										command: `node ${JSON.stringify(reflectHookPath)}`,
										timeout: 120,
									},
								],
							},
						],
					},
				},
				null,
				2,
			)}\n`,
		);
		writeIfEmpty(
			join(worktreePath, "opencode.json"),
			`${JSON.stringify(
				{
					$schema: "https://opencode.ai/config.json",
					instructions: [
						"../memory/AGENT.md",
						"../memory/USER.md",
						"../memory/MEMORY.md",
						"../memory/.writeback-protocol.md",
					],
				},
				null,
				2,
			)}\n`,
		);

		// Keep the generated bridge files out of the repo (local, per-worktree).
		// Guard against a duplicate block when re-run by the backfill. Resolved via
		// git-common-dir (not assumed `<worktree>/.git/info`) — same rationale as
		// the skills exclude above; a linked worktree's `.git` is a plain file.
		const excludeMarker = "# ADE agent bridge files (generated, not committed)";
		writeGitExclude(worktreePath, excludeMarker, BRIDGE_EXCLUDES.join("\n"));

		// Codex needs the concatenated bridge (it can't import). Generate it now;
		// it is regenerated on each codex launch.
		if (runtime === "codex") {
			regenerateCodexAgentsMd(agentId);
		}
	}
}
