---
name: brain-author
description: Author a RyanOS superagent brain from a seed-brain manifest.
version: 0.1.0
platforms: [macos]
metadata:
  ade:
    tags: [RyanOS, Authoring]
---

# Brain Author

Authors one RyanOS agent's brain (persona.txt + context/CLAUDE.md + mcp.json +
starter skills) into `assets/seed-brains/<slug>/brain/` from a manifest, seeded
from Ryan's vault (QMD), repo CLAUDE.md/STATUS.md, and Hermes profiles. Does NOT
touch MEMORY.md or learned skills — re-authoring is always memory-safe.

## When to Use
- "author the brain for <agent>", "brain-author <slug>", or a fan-out over the manifests.

## Prerequisites
- Manifest at `assets/seed-brains/<slug>/manifest.yaml` (see references/manifest-schema.md).
- QMD: `node "/Users/ryannaquin/.claude/plugins/cache/braynee/braynee/2.1.10/scripts/qmd-wrapper.mjs" search "<terms>"`.

## Procedure
1. Read `assets/seed-brains/<slug>/manifest.yaml`.
2. Gather sources:
   - Each `vault:<slug>` → QMD `search`/`query`; VERIFY it exists. A dead ref is dropped and noted (never cite a note that isn't there).
   - Each `repo:<path>` → Read the file (CLAUDE.md / STATUS.md).
   - Each `hermes:<name>` → locate the profile (search `~/Code` and the vault via QMD for "Hermes <name> profile"); if absent, note it and proceed honestly.
3. Draft the four artifacts into `assets/seed-brains/<slug>/brain/`:
   - `persona.txt` — Profile+Contract, < ~1,000 chars, distinct voice, autonomy + verbatim safety lines, roster awareness. Overflow domain detail to context.
   - `context/CLAUDE.md` — Knowledge as POINTERS to the verified sources. No copied prose. No cross-dir @-imports.
   - `mcp.json` — `{ "mcpServers": { ... } }` for the manifest's curated tools only.
   - `skills/<name>/SKILL.md` — 0–2 starter skills (agentskills.io format).
4. Self-check against references/acceptance-checklist.md.
5. Human review (Ryan). On approval, optionally refresh the LIVE agent for a fast
   boot-test: find the live dir by matching the agent name, then overwrite ONLY
   persona.txt / context/CLAUDE.md / mcp.json and ADD skills — NEVER MEMORY.md:
   ```bash
   # find the live agent home by persona name match
   grep -l "You are <Agent Name>" ~/.ade/agents/*/persona.txt
   ```

## Pitfalls
- persona.txt overflow silently truncates the system prompt — keep it tight.
- Copied vault prose rots; always point at the SSOT slug.
- Never write MEMORY.md or clobber a learned skill dir (violates the core invariant).

## Verification
- `assets/seed-brains/<slug>/brain/persona.txt` exists, non-empty, < ~1,000 chars.
- Every vault pointer in context/CLAUDE.md resolves via QMD.
- `getAuthoredBrainDir("<Agent Name>")` (Task 1) returns the brain dir.
