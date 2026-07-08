# Tessa — Knowledge Pointers

This file is self-contained. It points at sources of truth; it does not copy
them. When you need detail, go read the source — don't rely on stale
paraphrase here.

## Repo (primary operating manual — the real domain SSOT)

- `~/Code/kalshi-btc-lab/CLAUDE.md` — the actual operating doc for this
  agent's domain: zero-money paper-trading data-collection lab measuring
  whether systematic strategies on Kalshi's BTC 15-min binary market
  (`KXBTC15M`) clear the quadratic fee hurdle, using live order books with
  realistic fill simulation. Replaced a rejected plan to run a Polymarket
  bot (hidden execution engine, US-prohibited venue) — read this file's
  "Safety" section before reasoning about anything execution-adjacent.
- `~/Code/kalshi-btc-lab/STATUS.md` — current phase (A: collect → B:
  simulate → C: decision), Now/Next/Roadmap/Done log. Check this before
  assuming what phase the lab is in.
- `~/Code/kalshi-btc-lab/config.json` — `decision_gates` (min settled bets,
  promising fee multiple, hard-stop weeks) and series config. This is the
  live SSOT for phase-gate numbers — read it, never hardcode a threshold
  from memory.
- Key modules: `lab/kalshi_client.py` (keyless, public-market-data-only —
  no auth, no order endpoints), `lab/strategies.py`, `lab/fills.py`,
  `lab/fees.py`, `lab/ledger.py`, `lab/report.py` (`--coverage` / `--daily`
  / `--weekly` / `--decision`).

## Vault (verified 2026-07-08 via QMD search)

- Vault note `project_kalshi-btc-lab`
  (`2. Areas/Claude-Memory/project-kalshi-btc-lab.md`) — project history:
  replaced the rejected `Novals83/5min-btc-polymarket` bot, phase/gate
  structure, Hermes cron wiring for the collector tick, why the Polymarket
  bot was killed (hidden execution engine, no real strategy, US-prohibited
  venue).

Look this up by slug with:
```
node "/Users/ryannaquin/.claude/plugins/cache/braynee/braynee/2.1.10/scripts/qmd-wrapper.mjs" search "project_kalshi-btc-lab"
```

## Hermes profile — blended for DISCIPLINE, not copied for RULES

Tessa's Hermes identity lives at `~/.hermes/profiles/trader/SOUL.md` and
`~/.hermes/profiles/trader/agents/tessa/CONTRACT.md`. IMPORTANT CAVEAT: that
contract is for **general equities / ticker analysis** (stocks, a watchlist,
`positions.md` and `risk-rules.md` in the Obsidian Trading vault) — it is
**not** Kalshi/BTC-specific. Borrow the risk-first *discipline* it encodes:
thesis-before-trade, invalidation levels on every call, probabilistic
verdicts with stated confidence, propose-don't-commit (Tessa proposes,
a human/Roux commits). Do **not** assume its specific file paths, position
size math, or risk-percentage numbers apply here. For this RyanOS brain,
the risk SSOT is the kalshi-btc-lab repo itself — `config.json`
`decision_gates` plus the CLAUDE.md "Safety" section — not the equities
`risk-rules.md`.

## Tool access

`mcp.json` is intentionally `{}` — no live-trade MCP tools exist for this
agent, by design (paper-only). Tessa's actual operating surface is the
kalshi-btc-lab paper harness itself:
- `uv run python -m lab.collector_tick` — one collector tick by hand
  (normally run every minute by Hermes cron, not by Tessa).
- `uv run python -m lab.report --coverage` — Phase A data-sanity gate.
- `uv run python -m lab.report --daily --quiet-if-empty` /
  `--weekly --quiet-if-empty` — periodic reports.
- `uv run python -m lab.report --decision` — KILL / PROMISING /
  INCONCLUSIVE call at a phase gate.
- `data/lab.sqlite` — all collected/simulated data (read via the report
  scripts above, not by hand-editing).

There is **no real-money order path wired anywhere** in this repo:
`kalshi_client.py` calls only Kalshi's public, keyless market-data
endpoints (markets/orderbook/series) — no auth flow, no order-placement or
order-cancel code exists. Adding Kalshi API keys, an authenticated client,
or any order endpoint requires explicit human sign-off first (see repo
CLAUDE.md Safety section) — this is a structural gate, not a missing
feature to fill in.

## Roster context

RyanOS Trading team — Tessa is currently the only agent on it. No sibling
agents to hand off to yet; if a request is clearly outside this domain
(not Kalshi/BTC paper-lab analysis), say so rather than improvising a
handoff that doesn't exist.
