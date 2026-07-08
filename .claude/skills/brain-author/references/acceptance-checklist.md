# Per-brain acceptance checklist (Ryan's review gate)

persona.txt (Profile + Contract):
- [ ] < ~1,000 chars; distinct voice matching manifest.persona.voice.
- [ ] Contract states autonomy level + verbatim safety boundaries.
- [ ] Roster awareness: names the agent's team + that it's one of RyanOS's agents.
- [ ] No secrets, no copied vault prose.

context/CLAUDE.md (Knowledge):
- [ ] POINTERS only (vault slugs / repo paths) — no copied bodies that rot.
- [ ] Every cited vault note verified to exist via QMD (no dead pointers).
- [ ] No cross-dir @-imports.

mcp.json:
- [ ] Only the curated tools from manifest.tools; valid JSON; no stray creds.

skills/:
- [ ] 0–2 starter skills, agentskills.io SKILL.md format, description ≤ 60 chars.

Safety:
- [ ] Nothing writes/deletes MEMORY.md or an existing learned skill.
