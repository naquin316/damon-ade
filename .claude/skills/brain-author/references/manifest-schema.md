# Brain manifest schema (assets/seed-brains/<slug>/manifest.yaml)

- `agent`            (string)  display name — MUST match seed-cockpit.ts exactly.
- `slug`             (string)  dir slug — MUST match AGENT_BRAIN_SLUGS in seed-brains.ts.
- `persona`          (map)     `name`, `voice`.
- `profile_from`     (list)    source refs → identity/voice. `vault:<slug>` | `repo:<path>` | `hermes:<name>` | `feedback:<slug>`.
- `contract_from`    (list)    source refs → always/never rules, safety boundaries.
- `knowledge_from`   (list)    source refs → the POINTERS in context/CLAUDE.md (never copied prose).
- `tools`            (list)    curated MCP server names for mcp.json.
- `autonomy`         (enum)    high | medium | low.
- `safety`           (list)    hard boundary lines, verbatim into the Contract.
- `starter_skills`   (list)    optional {name, purpose} for 1–2 seed skills.

Ref resolution:
- `vault:<slug>`  → QMD verify it exists, then cite as a pointer. Dead ref → OMIT + note in review.
- `repo:<path>`   → Read the file; cite the path as a pointer.
- `hermes:<name>` → locate the Hermes profile (see SKILL.md); cite as a pointer.
- `feedback:<slug>`/`brand rules` → fold into the Contract as always/never rules.
