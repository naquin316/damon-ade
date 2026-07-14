# RyanOS Orchestrator — Durability & Result-Passing Upgrades — Design

- **Date:** 2026-07-14
- **Repo:** damon-ade (RyanOS)
- **Status:** proposed (design), pending live-verify of the base orchestrator first
- **Author:** Ryan + Claude (framework-comparison session)
- **Follows:** `2026-07-13-orchestrator-conductor-design.md`

## Summary

*Three upgrades that close the base orchestrator's real gaps, drawn from a comparison
against CrewAI and pydantic-ai. All three land in layers we already built — the
`EngineDeps` DI seam and the manifest-as-durable-state — so none of them require an
agent rewrite, and the first two are transport-agnostic (they survive a later Agent
SDK port).*

The base orchestrator (Conductor plans → approve → wave-dispatch → poll handoff notes →
DAG-drive to terminal) is code-complete and unit-tested but **has never run
end-to-end**, and two capabilities a "proven framework" would give for free are missing:

1. **Result-passing** — an upstream node's output never reaches its downstream node.
   The engine records `node.result`, but the dispatch note carries `task` only.
2. **Result validation + retry, and crash resume** — results are read raw with no
   validation, there is no retry-with-feedback, and a mid-run app restart abandons the run.

This spec specifies both, plus a scoped evaluation of porting the transport onto the
**Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`), which subsumes parts of 1 and 2.

## Why these three (framework comparison)

| Borrowed from | Idea | Our gap it closes |
|---|---|---|
| **CrewAI** `Task.context=[...]` | Upstream task output concatenated into the downstream prompt (raw string, not a typed bus) | Downstream agents get nothing from upstream (`orchestrator.ts` dispatch closure sends `task` only) |
| **pydantic-ai** `output_type` + `ModelRetry` + `output_retries` | Validate structured output; on failure feed the error back as the model's next input, bounded by a retry budget | Results read raw (`handoff.ts:71`), no validation, no retry-with-feedback |
| **pydantic-ai** durable exec (pydantic-graph / DBOS / Temporal) | Persist run state so a crashed worker resumes mid-run | Manifest already persists state; **no resume trigger exists** |
| **Claude Agent SDK** | In-process `query()` transport: structured output, sessions, cost/streaming observability | Detached-spawn + file-poll transport is fragile, opaque, and can't pass sessions or cost |

## The load-bearing insight

Two properties of the existing build make all of this cheap:

- **`EngineDeps` is a DI seam.** `stepRun` calls `deps.dispatch(node)` / `deps.pollStatus(node)`
  and knows nothing about *how* agents run. Transport is swappable without touching the
  graph, DAG, wave logic, or tests.
- **The manifest is already durable state.** `run-<uuid>.md` holds every node's status,
  `handoff_id`, and `result`, rewritten on every `onUpdate`. That is 80% of a durable
  engine — only the resume trigger is missing.

**Consequence (drives sequencing):** Features 1 and 2 live in the engine/manifest layer
and are **transport-agnostic**. Feature 3 swaps only the transport *beneath* them. So 1
and 2 are not throwaway if we later do 3 — the SDK changes *how a result arrives*, not
*how results flow through the graph or get validated*.

---

## Feature 1 — Result-passing (CrewAI `context` analog)

### Gap
- `startRunLoop`'s dispatch closure (`orchestrator.ts:239-257`) writes the note with
  `task: n.task` only.
- `writeDispatchNote` **already accepts a `facts` param** (`handoff.ts:16`, rendered as
  `## Facts`) — never populated.
- `stepRun` **already captures** `n.result = s.result` on done (`engine.ts:31`).
- Missing pipe is the middle: `dispatch` receives a single node with no view of its
  siblings' results.

CrewAI's `context` is raw concatenation of upstream `.raw` outputs into the downstream
prompt — the right target for a file-based model.

### Design

**1. Give `dispatch` the upstream nodes.** Change the `EngineDeps.dispatch` signature;
the engine already has all nodes in scope at the dispatch site (`engine.ts:65-70`):

```ts
// engine.ts — EngineDeps
dispatch: (node: RunNode, upstream: RunNode[]) => { ok: boolean; error?: string };

// engine.ts — inside the readySet dispatch loop (~line 70)
const upstream = target.needs
  .map((id) => nodes.find((x) => x.id === id))
  .filter((x): x is RunNode => !!x && x.status === "done");
const r = deps.dispatch({ ...target }, upstream);
```

Backward-compatible for tests that ignore the second arg.

**2. The closure builds the context block** (`startRunLoop`):

```ts
dispatch: (n, upstream) => {
  const handoffId = n.handoff_id ?? `${runId}-${n.id}`;
  const facts = upstream.length
    ? upstream
        .map((u) => `### From ${u.agent} (${u.id})\n${u.result ?? "(no result recorded)"}` +
                    (u.artifact ? `\nFull output: ${u.artifact}` : ""))
        .join("\n\n")
    : undefined;
  writeDispatchNote(vaultRoot(), {
    slug: n.agent, handoffId, runId, task: n.task, facts,
    created: new Date().toISOString().slice(0, 10),
  });
  return dispatchAgent(realDispatchDeps, n.agent, `Process your inbox for run ${runId} now.`);
},
```

**3. Payload decision — artifact + summary, not a fat frontmatter string.**
`result` is a single YAML frontmatter string (`types.ts:32`); cramming a content-plan
or a batch of drafted posts into YAML is fragile. We are on a filesystem, so use it:

- Agent writes its **full output** to `2. Areas/Orchestrator/artifacts/<runId>/<nodeId>.md`.
- Sets `result:` = a short 2–3 sentence summary, and a new `artifact:` = the vault path.
- One optional field added rather than overloading the string:

```ts
// types.ts — runNodeSchema
result: z.string().nullable().default(null),    // short summary — feeds downstream prompts
artifact: z.string().nullable().default(null),  // vault-relative path to full output
```

- `## Facts` injects the summary **and** the path — token-cheap and lossless (a
  downstream agent `Read`s the artifact only if it needs detail). Strictly better than
  CrewAI's dump-everything-in-prompt.

**4. Agent contract.** Update each seed-brain's `handoff` receive SKILL so "on done"
means: write the artifact, set `status: done`, `result: <summary>`, `artifact: <path>`.
This is the one piece outside the code and the piece that must work in the first live run.

### Files touched
`shared/orchestrator/types.ts`, `main/lib/orchestrator/engine.ts`,
`main/lib/orchestrator/handoff.ts` (read `artifact` in `readHandoffStatus`),
`lib/trpc/routers/orchestrator.ts`, seed-brain `handoff` SKILLs. **~40 LOC + SKILL edit.**

### Tests
Extend `engine.test.ts` (dispatch receives upstream done-nodes with results),
`handoff.test.ts` (facts + artifact round-trip).

---

## Feature 2 — Validated results + retry-with-feedback + crash resume (pydantic-ai analogs)

Three distinct borrowings, in value order.

### 2a — Validate the result (`output_type` analog)
`readHandoffStatus` returns `d.result ?? null` with no validation (`handoff.ts:71`).
Attach an output shape to each capability's `emits` keys:

```yaml
# strategist/capabilities.yaml
emits: [content-plan]
emit_schema:
  content-plan:
    required: [summary, artifact]
```

Add an injected validator to `EngineDeps` and gate the done-transition in `stepRun`'s
collect loop (`engine.ts:30-32`):

```ts
// engine.ts
validateResult?: (node: RunNode, result: string | null) => { ok: true } | { ok: false; error: string };

// replacing: n.status = "done"; n.result = s.result;
const v = deps.validateResult?.(n, s.result) ?? { ok: true };
if (v.ok) { n.status = "done"; n.result = s.result; }
else { /* retry path — 2b */ }
```

### 2b — Retry with the error fed back (`ModelRetry` analog)
On validation failure, the error becomes the model's next input, bounded by a budget:

- Add `attempts: z.number().default(0)` to the node schema — persisted in the manifest,
  so retry survives a restart.
- If invalid and `attempts < MAX_OUTPUT_RETRIES` (default **2**, mirroring pydantic-ai):
  clear the old note, bump `attempts`, redispatch with the error prepended to the task:

```
⚠️ Your previous result was rejected: <error>
Fix it and re-emit.

## Original task
<node.task>
```

- On budget exhaustion → `n.status = "failed"` → existing `applyFailureSkips` path.

### 2c — Crash resume (pydantic-graph / DBOS analog — biggest free win)
The manifest already persists node status + `handoff_id`. Only a startup scan is missing:

```ts
export function recoverInFlightRuns() {
  for (const run of listRuns().filter((r) => r.status === "running")) {
    if (!activeRuns.has(run.run_id)) startRunLoop(run);  // activeRuns already guards dupes
  }
}
```

Safe and near-free because of properties already built:
- `writeDispatchNote` **dedups** (`handoff.ts:24`) → dispatched nodes are not re-spawned.
- `pollStatus` reads the **existing** note → a node finished while we were down is
  immediately collected as `done`.
- Agents spawn `detached: true` + `unref()` (`orchestrator.ts:136-139`) → they **survive
  an Electron crash**, keep working, and write their note; on resume we pick up the output.
- `dispatchedAt` resets to a fresh Map → the pickup-timeout clock restarts cleanly for
  genuinely orphaned nodes.

Call `recoverInFlightRuns()` once from main-process startup.

### Files touched
`shared/orchestrator/types.ts` (`attempts`), `main/lib/orchestrator/engine.ts`
(validate gate + retry), `main/lib/orchestrator/capabilities.ts` (load `emit_schema`),
`lib/trpc/routers/orchestrator.ts` (validator dep, `recoverInFlightRuns`, wire to startup).
**~60–80 LOC.**

### Tests
`engine.test.ts`: invalid result → retry with bumped `attempts`; budget exhaustion →
failed + skips. New `recover.test.ts`: a "running" manifest re-enters the loop without
re-dispatching a done node.

---

## Feature 3 — Port the transport onto the Claude Agent SDK (scoped evaluation)

**What it is:** replace the detached-spawn + file-poll transport with `query()` from
`@anthropic-ai/claude-agent-sdk` (TS, v0.3.x). A **transport swap behind the DI seam** —
engine, DAG, waves, manifest, and Features 1–2 stay.

### Brain config mapping — CORRECTED 2026-07-14 against the real 0.3.x API

> The table below originally claimed "maps 1:1 (verified)". It was **not** verified, and
> two rows were wrong. Checked against the published SDK docs on 2026-07-14 (latest
> `@anthropic-ai/claude-agent-sdk` = **0.3.209**). Corrections marked ⚠️.

| Today (`agent-launch.ts`) | Agent SDK `Options` | Status |
|---|---|---|
| `--append-system-prompt-file persona.txt` | `systemPrompt: { type:'preset', preset:'claude_code', append: <persona> }` | ✅ confirmed |
| `--add-dir context/` | `additionalDirectories: [context]` | ✅ confirmed |
| `--mcp-config mcp.json` | `mcpServers: { name: { command?/url?/headers?/env? } }` | ✅ confirmed |
| `--strict-mcp-config` | — | ⚠️ **no such option.** Not in 0.3.x `Options`. Isolation must come from `mcpServers` being explicit + `settingSources` omitted. |
| `--model 'claude-opus-4-8[1m]'` | `model: 'claude-opus-4-8'` | ⚠️ **`[1m]` is a Claude Code CLI convention the SDK does not parse.** Pass the bare id. (Reported: opus-4-8 is 1M by default, so the window is retained — **verify empirically in the spike**, this is the single fact the whole 1M assumption rests on.) |
| `--dangerously-skip-permissions` | `permissionMode: 'bypassPermissions'` | ✅ confirmed |
| `brain/skills/*` | `skills: [...] \| 'all'`, or `settingSources: ['project']` | ✅ confirmed |

### Feature 3's premise HOLDS — structured output is real

Verified against the docs, and worth stating because a first research pass wrongly
concluded the opposite:

```ts
for await (const m of query({ prompt, options: { outputFormat: { type: 'json_schema', schema } } })) {
  if (m.type === 'result' && m.subtype === 'success' && m.structured_output) { /* validated */ }
  else if (m.type === 'result' && m.subtype === 'error_max_structured_output_retries') { /* gave up */ }
}
```

`SDKResultMessage` (success) carries `structured_output?`, `total_cost_usd`, `usage`,
`modelUsage`, `session_id`, `num_turns`, `permission_denials`. So per-node cost
(Phase 5.2) and Feature 2a/2b really do come free.

### Auth does NOT change the billing model (the thing that would have killed it)

> **"If you have already authenticated Claude Code by running `claude` in your terminal,
> the SDK will use that authentication automatically."**

`Query.accountInfo()` returns `{ subscriptionType, tokenSource, apiKeySource, … }`. So a
port does **not** force a switch from the Claude Code subscription onto metered
`ANTHROPIC_API_KEY` billing. This was the biggest latent risk in the whole proposal — an
unmetered 12×Opus-1M fan-out flipping to per-token billing — and it does not apply.
(Anthropic notes API-key auth is the *recommended* method for third-party distribution;
irrelevant here, this is Ryan's own machine.)

### ⚠️ The real open risk: does MCP OAuth survive the port?

Blotato is an **OAuth HTTP MCP** (`https://mcp.blotato.com/mcp`) with **no API key**
(confirmed: nothing in `env` or `~/.secrets.zsh`). The SDK's documented MCP auth story is
*explicit* credentials — `headers: { Authorization: ... }` for HTTP/SSE, `env: {...}` for
stdio. There is no documented way to hand it an OAuth session the Claude Code CLI already
holds.

If MCP OAuth does not come along, **sm-manager cannot be ported** — it is the only agent
holding Blotato, and Blotato is the only thing that publishes. That directly contradicts
this spec's "Seed-brains keep persona, MCP (Blotato stays wired)…" claim.

**This is now the first question the spike must answer, ahead of everything else.** Port a
Blotato-holding agent FIRST, not a simple one — a spike that ports a trivial agent proves
nothing about the constraint that actually decides this.

Seed-brains keep persona, context, and skills — **no agent rewrite** (the whole reason not
to adopt CrewAI). MCP is the asterisk.

### Fitting a resolving `query()` to a poll-based engine
Bridge via an in-memory status map so `stepRun` never changes:

```ts
const live = new Map<string, { status: string; result: string | null }>();

const sdkDispatch: EngineDeps["dispatch"] = (node, upstream) => {
  live.set(node.id, { status: "running", result: null });
  void (async () => {
    for await (const m of query({
      prompt: buildPrompt(node.task, upstream),   // Feature 1's context block, inline
      options: {
        systemPrompt: { type: "preset", preset: "claude_code", append: persona(node.agent) },
        additionalDirectories: [context(node.agent)],
        mcpServers: mcp(node.agent),
        model: "claude-opus-4-8[1m]",
        permissionMode: "bypassPermissions",
        resume: sessionIdFor(node),               // retries keep context
        outputFormat: { type: "json_schema", schema: emitSchema(node.agent) },  // Feature 2, free
      },
    })) {
      if (m.type === "stream_event") emit(/* live tokens/cost → Run Board */);
      if (m.type === "result") live.set(node.id, {
        status: "done", result: JSON.stringify(m.structured_output),
      });
    }
  })();
  return { ok: true };
};

const sdkPollStatus: EngineDeps["pollStatus"] = (node) => live.get(node.id) ?? null;
```

### What Features 1 & 2 get for free on the SDK
- **Result-passing** → `result` message carries final output directly; no note round-trip,
  no YAML fragility.
- **Validation + retry** → `outputFormat: json_schema` validates against `emit_schema`
  inside the SDK, with built-in retries (`error_max_structured_output_retries`). Feature
  2b becomes a fallback, not the primary path.
- **Sessions** → capture `session_id`, store on the node, `resume` on retry (impossible
  in the file model).
- **Observability** → `total_cost_usd` + `modelUsage` per node; `stream_event`s piped
  into `bus.emit` → the Run Board shows **live tokens and cost per node**. A tier the
  file-poll model structurally cannot reach.

### What we give up / must weigh
- **Vault handoff notes as coordination substrate** go away for orchestrated runs (task
  arrives in the prompt, not the inbox). The `handoff` receive-SKILL becomes vestigial for
  orchestration (still fine for human→agent handoffs). Decide whether Obsidian-inspectable
  audit trail matters enough to keep writing notes in parallel (cheap).
- `query()` still spawns a subprocess per call — keep `ORCH_MAX_CONCURRENT`.
- New dependency + fast-moving version surface.

### SPIKE RESULT (2026-07-14) — ran it. Verdict: **NOT YET. Two blockers.**

Rather than build the transport and A/B it, the two questions that decide the port were
answered directly by a ~$0.81 probe against the real SDK (0.3.209) with sm-manager's
actual `mcp.json`. Everything below is *measured*, not read.

**What works — better than hoped:**

| Claim | Measured |
|---|---|
| Auth / billing | `accountInfo()` → `{ subscriptionType: "Claude Max", apiProvider: "firstParty" }`. **The SDK reused the CLI's subscription. No API key, no billing change.** |
| 1M context without `[1m]` | `modelUsage["claude-opus-4-8"].contextWindow` = **1000000**. Open question closed: pass the bare id, keep the window. |
| Structured output | `outputFormat: {type:'json_schema'}` → `subtype: "success"` + a schema-valid `structured_output` object. Feature 2a/2b really are free. |
| Per-node cost | `total_cost_usd: 0.5476935` + full `modelUsage` breakdown. Phase 5.2's cost visibility is a property read, not a project. |

**Blocker 1 — Blotato's OAuth does NOT survive the port.**
Init reported `{"name":"blotato","status":"needs-auth"}` and **`blotato tools exposed: []`**.
The agent's own words: *"This session is non-interactive, so the OAuth flow cannot be run
here."* sm-manager is the only agent holding Blotato and Blotato is the only thing that
publishes — so **the one agent whose port would matter is the one agent that cannot port.**
This directly refutes this spec's "Seed-brains keep … MCP (Blotato stays wired)".

**Blocker 2 — MCP isolation is UNACHIEVABLE, and it's a blast-radius regression.**
The probe passed `mcpServers: { blotato }` — exactly one server. The session came up with
**30**: chrome-devtools, firecrawl, linear, outline, Gmail, Google Drive, Google Calendar,
Supabase, Cloudflare, **Zapier (which holds Shopify WRITE tools)**…

`settingSources: []` cut it to **16** — still 15 unrequested `claude.ai *` connectors. They
are **account-level remote connectors, not local settings**, so they ride along with the
subscription auth itself. There is no documented way to refuse them.

That is the sting: **the two properties are coupled.** Subscription billing (Blocker-1's
consolation, and the reason the port looked cheap) is exactly what drags in the account's
connectors. You cannot take one without the other.

Today `--strict-mcp-config` guarantees an agent sees *only* its own `mcp.json` — that flag
is load-bearing, and it has **no SDK equivalent**. Port the fleet and every agent silently
gains ~15 tools its brain never granted and its persona never mentions, while running
`permissionMode: 'bypassPermissions'`. A repurposer whose `mcp.json` is deliberately an
*empty stub* ("You have NO live tools") would come up holding Gmail and Zapier. That is not
a port; it's a quiet privilege escalation across the whole fleet.

**Bonus finding — the leak is not just unsafe, it's expensive.** A one-word "reply ok"
prompt cost **$0.26**, and the real probe **$0.55**, almost entirely tool-definition bloat
(49k cache-creation tokens). At 12 agents that's ~$6.60 a run before any work happens.
Ironic, given Phase 5.2 wants the port *for* cost visibility.

**Verdict: do not port yet.** Not because the SDK is bad — its output/cost/session story is
strictly better — but because it cannot express *"this agent gets exactly these tools"*,
which the current transport does for free and which the whole fleet's safety rests on.

**What would unblock it**, in order:
1. A way to hard-scope MCP servers per `query()` (an SDK `strictMcpConfig` equivalent, or
   account-connector opt-out). Without this, nothing else matters.
2. A non-interactive auth path for OAuth HTTP MCPs (a Blotato API key would also do it, and
   is worth asking Blotato for — it would decouple this entirely).
3. Then, and only then, the A/B — starting with **sm-manager**, not a trivial agent.

Reusable probe: `scratchpad/sdk-probe/` (kept out of the repo; the SDK is deliberately NOT
a dependency yet).

### Migration (low-risk, behind a flag)
```ts
const dispatchDeps = process.env.ORCH_TRANSPORT === "sdk" ? sdkDeps : fileDeps;
```
Port one agent first; A/B a real goal through each; engine + tests identical.

---

## Recommended sequencing

1. **Feature 1 minimal (~40 LOC), now.** Transport-agnostic, reused by the SDK port, and
   the literal thing blocking the first end-to-end run.
2. **Feature 2c resume scan (~10 LOC), now.** Absurd value-to-effort; crash-safe using
   state already persisted.
3. **Prove it live** — one real Strategist→Repurposer goal. Retires the actual risk
   (never-run) and validates the agent SKILL contract.
4. **Then decide the SDK port** as a deliberate bet. It subsumes 2a/2b — so do **not**
   over-build the file-based validation machinery first. Spike one agent through `query()`
   behind the flag and compare.

Net: keep the framework; do 1 + 2c immediately (cheap, framework-agnostic); prove a live
run; treat the SDK port as the high-upside transport upgrade with no agent rewrite.

## Open questions

**Answered 2026-07-14** (docs check against 0.3.209 — no code written):
- ~~Does `model: 'claude-opus-4-8[1m]'` pass the `[1m]` suffix through the SDK?~~ **No.**
  `[1m]` is a CLI convention; pass `'claude-opus-4-8'`. Whether the 1M window is retained
  by default still needs empirical confirmation in the spike.
- ~~Is `outputFormat: json_schema` real in the Agent SDK?~~ **Yes** — `structured_output`
  on the success result, `error_max_structured_output_retries` on give-up.
- ~~Does porting change the billing model?~~ **No.** The SDK reuses an existing
  `claude`-CLI authentication automatically.

**Answered by the spike (probe, same day) — see SPIKE RESULT above:**
- ~~Does an OAuth'd HTTP MCP (Blotato) survive the port?~~ **No.** `status: needs-auth`,
  zero blotato tools exposed. Blocker 1.
- ~~Is `claude-opus-4-8` still 1M without `[1m]`?~~ **Yes** — measured `contextWindow:
  1000000`.
- ~~Does omitting `settingSources` give isolation equivalent to `--strict-mcp-config`?~~
  **No, and neither does `settingSources: []`.** 30 servers leaked, 16 with `[]`. Account
  connectors are inseparable from subscription auth. Blocker 2.

**Still open:**
1. Can MCP servers be hard-scoped per `query()` at all? (Blocks everything.)
2. Non-interactive auth for an OAuth HTTP MCP — or ask Blotato for an API key, which
   would sidestep it entirely and is cheap to try.
3. Keep writing vault handoff notes in parallel under the SDK transport (audit trail) or
   drop them for orchestrated runs?
4. `emit_schema` granularity: per-capability JSON schema vs. a lightweight required-keys
   check to start?

## Non-goals
- No change to the Conductor planning phase, the DAG wiring, or the wave concurrency cap.
- No cron/Telegram triggering (still deferred per the base design).
- No multi-goal concurrency.
