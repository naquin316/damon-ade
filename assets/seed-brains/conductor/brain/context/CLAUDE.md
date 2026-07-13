# Conductor — Knowledge Pointers

This file is self-contained. It points at sources of truth; it does not copy them.

## Roster

The roster is injected at plan time — every `assets/seed-brains/<slug>/capabilities.yaml`
in this repo, parsed by `apps/desktop/src/main/lib/orchestrator/capabilities.ts`
(`loadRoster()` / `loadRosterFrom()`) against the schema in
`apps/desktop/src/shared/orchestrator/types.ts` (`capabilityManifestSchema`). Each
manifest is:

```yaml
team: <team name>
agent: <slug>          # == the seed-brain directory slug == handoff recipient-slug
handles: [...]          # real, human-readable capabilities — never invent one
needs:  [<vocab keys>]   # capabilities this agent consumes from other agents
emits:  [<vocab keys>]   # capabilities this agent produces for other agents
gate:   <name>           # optional — a human-approval checkpoint this agent enforces
```

Never plan with an agent slug that isn't in the injected roster, and never assign a node
a `handles` capability its manifest doesn't list.

## Run directory

Every plan is written as a run manifest at:

```
<VAULT>/2. Areas/Orchestrator/runs/<run_id>.md
```

(`<VAULT>` = `apps/desktop/src/main/lib/orchestrator/vault.ts` → `vaultRoot()`, path
helpers in `paths.ts` — `runsDir()` / `runPath()`.) The manifest shape is
`runManifestSchema` in `shared/orchestrator/types.ts`: frontmatter `run_id, goal, status,
created, nodes[], summary`, one `runNodeSchema` entry per node (`id, agent, task, needs,
status, handoff_id, result`).

## The shared needs/emits vocabulary

A small, flat, exact-match keyword set. `needs`/`emits` in every `capabilities.yaml` MUST
draw only from this list — the engine's `wireDependencies()` matches a consumer's `needs`
key against an earlier node's `emits` key by exact string equality, first producer in
node order wins. Do not add a key here without also using it in at least one manifest.

| key             | meaning                                                                 |
|------------------|--------------------------------------------------------------------------|
| `product-facts`  | Concrete, verified facts about an HLD product/event (price, dates, sale %, specs). |
| `mockups`        | Composited product mockup images (Foreman's mockup-engine output).      |
| `listing`        | A drafted/published product listing — copy + images ready for Shopify.  |
| `collection`      | A staged storefront collection or growth event (sale, feature, restock). |
| `angle`          | A suggested content angle/hook for a post.                              |
| `content-plan`    | A weekly per-brand posting plan (themes, mix, which slots to fill).      |
| `drafted-posts`   | Graded, approval-queued social posts (terminal — consumed by Ryan/Blotato, not another agent). |
| `clip-verdict`    | A YouTube clipping's triage verdict (knowledge/pitch/skipped) + mini-PRD (terminal — consumed by Ryan via Telegram). |
| `script`         | A drafted YouTube script — hook, beats, CTA (terminal — consumed by Ryan). |

Terminal keys (no current consumer in the roster) are still real capabilities — their
consumer is Ryan or an external system (Telegram, Blotato), not another agent node. Keep
this table in sync with the manifests; it is the only place the vocabulary is defined.

## Known wired chain (worked example)

`foreman-listings` emits `mockups`/`listing`/`product-facts` → `shopify-store-cockpit`
needs `mockups`/`listing`/`product-facts` and emits `collection`/`product-facts`/`angle`
→ `sm-manager` needs `collection`/`product-facts`/`angle`. This is the Father's Day plan
in `skills/conduct/SKILL.md`.
