#!/usr/bin/env bun
/**
 * Approval Queue web viewer (The Conn v2 — "the 2am scene", local-first).
 *
 * A localhost page that reads `2. Areas/Social Media/Approval Queue/` and renders
 * every note as a card — media, copy, provenance, and the drain's ACTUAL verdict —
 * with same-weight Approve / Skip. Approving flips the same `approved` checkbox the
 * launchd drain already consumes: no endpoint, no second database, the vault is the
 * bus. Built to the approved v2 design
 * (~/Code/the-conn/docs/superpowers/specs/2026-07-14-conn-v2-approvals-design.md); the
 * same page deploys onto The Conn once v1 ships.
 *
 * Reuses queue.ts (readNote/classify/extractCopy/upsertFrontmatter) so the viewer
 * shows exactly what the drain will do and writes files identically.
 *
 *   BLOTATO_API_KEY=... op run -- bun apps/desktop/scripts/queue-server.ts
 *   (or ./scripts/queue-server.sh, which resolves the key)
 *
 * The key is OPTIONAL: without it, cards still render but shippability shows
 * "unknown (no Blotato)" instead of ready/blocked.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type BlotatoAccount,
	indexAccounts,
	listAccounts,
	uploadMedia,
} from "../src/main/lib/approval-queue/blotato";
import { createDraft } from "../src/main/lib/approval-queue/intake";
import {
	classify,
	type QueueNote,
	readNote,
	upsertFrontmatter,
} from "../src/main/lib/approval-queue/queue";
import { splitFrontmatter } from "../src/main/lib/orchestrator/frontmatter";
import { vaultRoot } from "../src/main/lib/orchestrator/vault";

// Minimal ambient decl so `tsc --noEmit` (which doesn't load bun-types for this
// script) accepts Bun.serve. Runtime is bun, where this is the real global.
declare const Bun: {
	serve(options: {
		port?: number;
		hostname?: string;
		fetch(req: Request): Response | Promise<Response>;
	}): { port: number };
};

const QUEUE_DIR = join(vaultRoot(), "2. Areas/Social Media/Approval Queue");
const PORT = Number(process.env.QUEUE_SERVER_PORT ?? 4319);

interface CardView {
	file: string;
	slug: string;
	status: string;
	approved: boolean | null;
	platforms: string[];
	media: string | null;
	copy: string | null;
	// provenance + display
	brand: string | null;
	grade: string | null;
	product: string | null;
	runId: string | null;
	source: string | null;
	ageDays: number | null;
	// verdict
	state:
		| "ready"
		| "blocked"
		| "scheduled"
		| "skipped"
		| "needs-review"
		| "shipping"
		| "unknown";
	verdict: string;
	escalation: string | null;
	scheduledTime: string | null;
	postIds: string[];
	/** `status: scheduled` but no blotato_post_ids — a past session marked it done
	 *  without ever booking it, so it will never post. Offer a re-queue. */
	orphaned: boolean;
}

/** Format an ISO time for display in Central. */
function fmtWhen(iso: string | null): string | null {
	if (!iso) return null;
	const t = Date.parse(iso);
	if (!Number.isFinite(t)) return null;
	return new Date(t).toLocaleString("en-US", {
		timeZone: "America/Chicago",
		weekday: "short",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

/** Display-only frontmatter read — tolerant, best-effort, never throws. */
function fmField(raw: string, key: string): string | null {
	const { data } = splitFrontmatter(raw);
	const v = (data as Record<string, unknown> | undefined)?.[key];
	if (typeof v === "string" && v.trim()) return v.trim();
	if (typeof v === "number") return String(v);
	const fm = raw.match(/^---\n([\s\S]*?)\n---/)?.[1];
	const m = fm?.match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"));
	return m?.[1]?.trim().replace(/^["']|["']$/g, "") || null;
}

/** An agent-raised blocker in the body — a `> [!warning]`/`[!caution]`/`[!blocked]`
 *  callout. Per the design, an escalation is the loudest thing on the card and
 *  DISABLES approve: an agent finishing good work that still needs a human is the
 *  highest-value moment in the system. */
function extractEscalation(raw: string): string | null {
	const m = raw.match(
		/^>\s*\[!(?:warning|caution|danger|blocked|attention)\][^\n]*\n((?:>[^\n]*\n?)*)/im,
	);
	if (!m) return null;
	return (
		m[1]
			.split("\n")
			.map((l) => l.replace(/^>\s?/, "").trim())
			.filter(Boolean)
			.join(" ")
			.trim() || null
	);
}

function ageDaysFromSlug(slug: string): number | null {
	const m = slug.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (!m) return null;
	const then = Date.parse(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`);
	if (!Number.isFinite(then)) return null;
	return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

function buildCard(
	file: string,
	raw: string,
	connected: Map<string, BlotatoAccount> | null,
): CardView {
	const note = readNote(file, raw);
	const slug = (file.split("/").pop() ?? file).replace(/\.md$/, "");
	const escalation = extractEscalation(raw);

	const scheduledTime = fmField(raw, "scheduled_time");
	const postIds = (fmField(raw, "blotato_post_ids") ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);

	let state: CardView["state"];
	let verdict: string;

	// A note the drain really scheduled carries blotato_post_ids. One marked
	// `scheduled` by a past session without them was never booked — it will never
	// post, and looking "done" is exactly why it's dangerous.
	const orphaned = note.status === "scheduled" && postIds.length === 0;

	if (note.status === "scheduled") {
		state = "scheduled";
		const when = fmtWhen(scheduledTime);
		verdict = orphaned
			? "Marked scheduled, but never booked — it won't post"
			: when
				? `Scheduled for ${when} CT`
				: "Scheduled ✓";
	} else if (note.status === "skipped") {
		state = "skipped";
		verdict = "Skipped";
	} else if (note.status === "needs-review") {
		state = "needs-review";
		verdict = "Needs review — check Blotato";
	} else if (note.status === "scheduling") {
		state = "shipping";
		verdict = "Shipping…";
	} else if (!connected) {
		state = "unknown";
		verdict = "Shippability unknown (no Blotato key)";
	} else {
		// Pending/approved: preview the drain's verdict AS IF approved, so a pending
		// card already shows "ready" or the exact block.
		const preview: QueueNote = { ...note, status: "approved", approved: true };
		const c = classify(preview, Date.now(), connected);
		if (c.kind === "shippable") {
			state = "ready";
			verdict =
				note.approved === true
					? "Approved — ships within 15 min"
					: "Ready — approve to ship";
		} else if (c.kind === "blocked") {
			state = "blocked";
			verdict = `Can't ship: ${c.reason}${c.detail ? ` — ${c.detail}` : ""}`;
		} else {
			state = "unknown";
			verdict = c.kind;
		}
	}

	return {
		file,
		slug,
		status: note.status,
		approved: note.approved,
		platforms: note.platforms,
		media: note.media,
		copy: note.copy,
		brand: fmField(raw, "brand"),
		grade: fmField(raw, "grade"),
		product: fmField(raw, "product"),
		runId: fmField(raw, "run_id"),
		source: fmField(raw, "source") ?? fmField(raw, "angle"),
		ageDays: ageDaysFromSlug(slug),
		state,
		verdict,
		escalation,
		scheduledTime,
		postIds,
		orphaned,
	};
}

function listNotes(): string[] {
	return readdirSync(QUEUE_DIR)
		.filter((f) => f.endsWith(".md"))
		.sort()
		.map((f) => join(QUEUE_DIR, f));
}

// The account set changes rarely (Ryan connects an account maybe monthly), but the
// page polls /api/queue every 5s. Cache it so a viewer left open doesn't hammer
// Blotato — same wasteful-polling lesson as the drain's idle ticks.
let accountCache: {
	at: number;
	value: Map<string, BlotatoAccount> | null;
} | null = null;
const ACCOUNT_TTL_MS = 60_000;

async function loadConnected(): Promise<Map<string, BlotatoAccount> | null> {
	if (accountCache && Date.now() - accountCache.at < ACCOUNT_TTL_MS)
		return accountCache.value;
	const apiKey = process.env.BLOTATO_API_KEY;
	if (!apiKey || apiKey.startsWith("op://")) {
		accountCache = { at: Date.now(), value: null };
		return null;
	}
	try {
		const value = indexAccounts(
			await listAccounts({ fetch: globalThis.fetch, apiKey }),
		);
		accountCache = { at: Date.now(), value };
		return value;
	} catch (e) {
		console.error(
			"[queue-server] could not reach Blotato:",
			e instanceof Error ? e.message : e,
		);
		accountCache = { at: Date.now(), value: null };
		return null;
	}
}

/**
 * Generate caption copy via `claude -p`, reusing Ryan's subscription (no API key).
 * spawnSync with an ARGV ARRAY, not a shell string — so the RYA-176 injection class
 * (backticks/$ in a prompt executed by /bin/sh) simply cannot happen. Returns the
 * model's final text from `--output-format json`.
 */
function claudeGenerateCopy(system: string, prompt: string): string {
	const r = spawnSync(
		"claude",
		[
			"-p",
			prompt,
			"--model",
			"claude-opus-4-8[1m]",
			"--append-system-prompt",
			system,
			"--output-format",
			"json",
		],
		{ encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 120_000 },
	);
	if (r.status !== 0 || !r.stdout) {
		throw new Error(
			`claude copy-gen failed (status ${r.status}): ${(r.stderr || "").slice(0, 200)}`,
		);
	}
	const parsed = JSON.parse(r.stdout) as { result?: string };
	if (!parsed.result) throw new Error("claude copy-gen: no result in output");
	return parsed.result;
}

/** Resolve a POSTed file path back to a real queue note — defends against a client
 *  sending a path outside the queue dir. */
function resolveQueueFile(file: string): string | null {
	const slug = (file.split("/").pop() ?? "").replace(/\.md$/, "");
	if (!slug || !/^[\w.-]+$/.test(slug)) return null;
	const path = join(QUEUE_DIR, `${slug}.md`);
	return listNotes().includes(path) ? path : null;
}

const server = Bun.serve({
	port: PORT,
	hostname: "127.0.0.1",
	async fetch(req) {
		const url = new URL(req.url);

		if (url.pathname === "/") {
			return new Response(PAGE, {
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		}

		if (url.pathname === "/api/queue") {
			const connected = await loadConnected();
			const cards = listNotes().map((f) =>
				buildCard(f, readFileSync(f, "utf8"), connected),
			);
			const pending = cards.filter(
				(c) => c.status === "pending" || c.status === "approved",
			);
			const oldest = pending.reduce((m, c) => Math.max(m, c.ageDays ?? 0), 0);
			return Response.json({
				cards,
				summary: {
					waiting: pending.length,
					oldestDays: oldest,
					connected: connected ? [...connected.keys()].sort() : null,
					sweptAt: new Date().toISOString(),
				},
			});
		}

		if (
			req.method === "POST" &&
			(url.pathname === "/api/approve" ||
				url.pathname === "/api/skip" ||
				url.pathname === "/api/requeue")
		) {
			const { file } = (await req.json().catch(() => ({}))) as {
				file?: string;
			};
			const path = file ? resolveQueueFile(file) : null;
			if (!path)
				return Response.json(
					{ ok: false, error: "unknown note" },
					{ status: 400 },
				);

			const raw = readFileSync(path, "utf8");
			// Approve = tick the checkbox the drain reads (leave status pending; the
			// checkbox IS the gate). Skip = mark it skipped. Re-queue = rescue an
			// orphaned "scheduled" note back to a fresh pending card.
			const next =
				url.pathname === "/api/approve"
					? upsertFrontmatter(raw, { approved: "true" })
					: url.pathname === "/api/requeue"
						? upsertFrontmatter(raw, { status: "pending", approved: "false" })
						: upsertFrontmatter(raw, { status: "skipped", approved: "false" });
			writeFileSync(path, next, "utf8");
			return Response.json({ ok: true });
		}

		// Intake front door (web): a photo (base64) + a hint -> upload -> HLD copy ->
		// a pending draft in the queue, which then flows through the same approve path.
		if (req.method === "POST" && url.pathname === "/api/intake") {
			const apiKey = process.env.BLOTATO_API_KEY;
			if (!apiKey || apiKey.startsWith("op://")) {
				return Response.json(
					{ ok: false, error: "no BLOTATO_API_KEY — cannot upload media" },
					{ status: 400 },
				);
			}
			const body = (await req.json().catch(() => ({}))) as {
				hint?: string;
				filename?: string;
				contentType?: string;
				base64?: string;
			};
			if (!body.hint?.trim())
				return Response.json(
					{ ok: false, error: "a hint (what the product is) is required" },
					{ status: 400 },
				);
			if (!body.base64)
				return Response.json(
					{ ok: false, error: "a photo is required" },
					{ status: 400 },
				);

			try {
				const bytes = new Uint8Array(Buffer.from(body.base64, "base64"));
				const blotato = { fetch: globalThis.fetch, apiKey };
				const { draft } = await createDraft(
					{
						upload: (f) => uploadMedia(blotato, f),
						generateCopy: (system, prompt) =>
							Promise.resolve(claudeGenerateCopy(system, prompt)),
						writeNote: (d) => {
							const p = join(QUEUE_DIR, d.filename);
							writeFileSync(p, d.content, "utf8");
							return p;
						},
						today: () => new Date().toISOString().slice(0, 10),
					},
					{
						bytes,
						filename: body.filename || "intake.jpg",
						contentType: body.contentType || "image/jpeg",
						hint: body.hint,
						door: "web",
					},
				);
				return Response.json({ ok: true, slug: draft.slug });
			} catch (e) {
				return Response.json(
					{ ok: false, error: e instanceof Error ? e.message : String(e) },
					{ status: 500 },
				);
			}
		}

		return new Response("not found", { status: 404 });
	},
});

console.log(`Approval Queue viewer → http://localhost:${server.port}`);
console.log(`Reading ${QUEUE_DIR}`);
if (
	!process.env.BLOTATO_API_KEY ||
	process.env.BLOTATO_API_KEY.startsWith("op://")
) {
	console.log(
		"(no BLOTATO_API_KEY — cards render, but ready/blocked shows 'unknown')",
	);
}

// ── the page (self-contained; The Conn tokens applied, not overridden) ──────────
const PAGE = /* html */ `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Approvals · The Conn</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root{
    --primary:#4A90E2; --ground:#171717; --card:#262626; --border:#404040;
    --ink:#ededed; --muted:#9a9a9a; --ok:#3fb27f; --warn:#e0a33e; --bad:#e0603e;
    --r:0.375rem; --serif:'Source Serif 4',Georgia,serif; --sans:'Inter',-apple-system,system-ui,sans-serif;
    --mono:'JetBrains Mono',ui-monospace,monospace;
  }
  *{box-sizing:border-box} html,body{margin:0}
  body{background:var(--ground);color:var(--ink);font-family:var(--sans);line-height:1.5;-webkit-font-smoothing:antialiased}
  header{position:sticky;top:0;z-index:5;background:linear-gradient(var(--ground),var(--ground) 70%,transparent);
    padding:1.25rem 1.25rem .75rem;border-bottom:1px solid var(--border)}
  h1{font-size:1.05rem;font-weight:700;margin:0;letter-spacing:-.01em}
  .summary{display:flex;gap:1rem;flex-wrap:wrap;margin-top:.35rem;font-family:var(--mono);font-size:.8rem;color:var(--muted)}
  .summary b{color:var(--ink);font-weight:500} .summary .stale{color:var(--warn)}
  .filters{display:flex;gap:.4rem;margin-top:.6rem;flex-wrap:wrap}
  .filters button{font-family:var(--sans);font-size:.78rem;color:var(--muted);background:transparent;
    border:1px solid var(--border);border-radius:999px;padding:.2rem .7rem;cursor:pointer}
  .filters button.on{color:var(--ink);border-color:var(--primary);background:rgba(74,144,226,.12)}
  main{max-width:1180px;margin:0 auto;padding:1.25rem;display:grid;gap:1rem;
    grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}
  .card{position:relative;background:var(--card);border:1px solid var(--border);border-radius:var(--r);
    overflow:hidden;display:flex;flex-direction:column}
  .card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--border)}
  .card.ready::before{background:var(--ok)} .card.blocked::before,.card.needs-review::before{background:var(--bad)}
  .card.scheduled::before{background:var(--primary)} .card.shipping::before{background:var(--warn)}
  .card.orphaned::before{background:var(--bad)}
  .orphan{grid-column:1/-1;display:flex;flex-direction:column;gap:.45rem}
  .orphan-msg{font-size:.8rem;color:var(--bad);font-weight:600;text-align:center}
  .thumb{aspect-ratio:1/1;background:#0e0e0e;display:flex;align-items:center;justify-content:center;overflow:hidden}
  .thumb img{width:100%;height:100%;object-fit:cover} .thumb .none{color:var(--muted);font-size:.8rem}
  .body{padding:.85rem .9rem 1rem;display:flex;flex-direction:column;gap:.6rem;flex:1}
  .chips{display:flex;gap:.35rem;flex-wrap:wrap;font-family:var(--mono);font-size:.68rem}
  .chip{color:var(--muted);border:1px solid var(--border);border-radius:999px;padding:.08rem .5rem}
  .chip.grade{color:var(--ink);border-color:var(--primary)}
  .verdict{font-size:.78rem;font-weight:500;display:flex;align-items:center;gap:.35rem}
  .verdict .dot{width:.5rem;height:.5rem;border-radius:50%;background:var(--muted);flex:none}
  .ready .verdict .dot{background:var(--ok)} .blocked .verdict .dot,.needs-review .verdict .dot{background:var(--bad)}
  .scheduled .verdict .dot{background:var(--primary)} .shipping .verdict .dot{background:var(--warn)}
  .copy{font-family:var(--serif);font-size:.95rem;line-height:1.55;white-space:pre-wrap;color:#e6e6e6;
    max-height:8.5rem;overflow:hidden;position:relative;transition:max-height .2s}
  .copy.open{max-height:none}
  .copy:not(.open)::after{content:"";position:absolute;left:0;right:0;bottom:0;height:2.5rem;
    background:linear-gradient(transparent,var(--card))}
  .expand{align-self:flex-start;background:none;border:none;color:var(--primary);font-size:.76rem;cursor:pointer;padding:0}
  .escalation{background:rgba(224,163,62,.1);border:1px solid var(--warn);border-radius:var(--r);
    padding:.55rem .65rem;font-size:.82rem;color:#f0d29a}
  .escalation b{color:var(--warn);display:block;font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;margin-bottom:.2rem;font-family:var(--mono)}
  .actions{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-top:auto}
  .actions button{font-family:var(--sans);font-size:.85rem;font-weight:600;padding:.55rem;border-radius:var(--r);cursor:pointer;border:1px solid var(--border)}
  .approve{background:var(--primary);border-color:var(--primary);color:#fff}
  .approve:disabled{background:#2f3b49;border-color:var(--border);color:var(--muted);cursor:not-allowed}
  .skip{background:transparent;color:var(--ink)}
  .approved-tag{grid-column:1/-1;text-align:center;font-size:.8rem;color:var(--ok);font-weight:600;padding:.4rem}
  .terminal-tag{grid-column:1/-1;text-align:center;font-size:.8rem;color:var(--muted);padding:.4rem}
  .sched{grid-column:1/-1;text-align:center;padding:.3rem;display:flex;flex-direction:column;gap:.25rem}
  .sched-when{font-size:.82rem;color:var(--primary);font-weight:600}
  .sched a{font-size:.74rem;color:var(--muted);text-decoration:none} .sched a:hover{color:var(--ink)}
  .empty{grid-column:1/-1;text-align:center;color:var(--muted);padding:3rem}
  footer{text-align:center;color:var(--muted);font-size:.72rem;font-family:var(--mono);padding:1rem}
  .newbtn{position:absolute;top:1.1rem;right:1.25rem;background:var(--primary);border:none;color:#fff;
    font-family:var(--sans);font-weight:600;font-size:.82rem;padding:.45rem .85rem;border-radius:var(--r);cursor:pointer}
  .overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:none;align-items:center;justify-content:center;z-index:20;padding:1rem}
  .overlay.on{display:flex}
  .modal{background:var(--card);border:1px solid var(--border);border-radius:var(--r);width:100%;max-width:440px;padding:1.25rem;display:flex;flex-direction:column;gap:.8rem}
  .modal h2{margin:0;font-size:1rem} .modal label{font-size:.78rem;color:var(--muted);display:block;margin-bottom:.3rem}
  .drop{border:1.5px dashed var(--border);border-radius:var(--r);padding:1.25rem;text-align:center;color:var(--muted);cursor:pointer;font-size:.85rem}
  .drop.has{border-color:var(--primary);color:var(--ink)} .drop img{max-height:180px;max-width:100%;border-radius:var(--r);margin-top:.5rem}
  .modal textarea{width:100%;background:var(--ground);border:1px solid var(--border);border-radius:var(--r);color:var(--ink);
    font-family:var(--sans);font-size:.9rem;padding:.55rem;resize:vertical;min-height:3.5rem}
  .modal .row{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}
  .modal button{font-family:var(--sans);font-weight:600;font-size:.88rem;padding:.6rem;border-radius:var(--r);cursor:pointer;border:1px solid var(--border)}
  .modal .gen{background:var(--primary);border-color:var(--primary);color:#fff} .modal .gen:disabled{opacity:.5;cursor:wait}
  .modal .cancel{background:transparent;color:var(--ink)}
  .modal .status{font-size:.8rem;color:var(--muted);min-height:1rem;font-family:var(--mono)}
</style></head>
<body>
<header>
  <button class="newbtn" onclick="openIntake()">+ New post</button>
  <h1>Approvals <span style="color:var(--muted);font-weight:400">· The Conn</span></h1>
  <div class="summary" id="summary">loading…</div>
  <div class="filters" id="filters"></div>
</header>
<main id="grid"><div class="empty">loading…</div></main>
<footer>the vault is the bus · approving flips <span style="color:var(--ink)">approved: true</span> · the drain ships within 15 min</footer>

<div class="overlay" id="overlay">
  <div class="modal">
    <h2>New post</h2>
    <div>
      <label>Photo</label>
      <div class="drop" id="drop" onclick="document.getElementById('file').click()">
        <span id="dropText">Tap to choose a photo</span>
        <input type="file" id="file" accept="image/*" style="display:none" onchange="pickFile(this)">
        <div id="preview"></div>
      </div>
    </div>
    <div>
      <label>What is it? (product, price, who it's for)</label>
      <textarea id="hint" placeholder="e.g. 30oz teacher tumbler, engraved with her name, $48"></textarea>
    </div>
    <div class="status" id="istatus"></div>
    <div class="row">
      <button class="cancel" onclick="closeIntake()">Cancel</button>
      <button class="gen" id="genBtn" onclick="submitIntake()">Generate draft</button>
    </div>
  </div>
</div>
<script>
const FILTERS=[["actionable","Needs you"],["ready","Ready"],["blocked","Blocked"],["scheduled","Scheduled"],["skipped","Skipped"],["all","All"]];
let filter="actionable", cards=[], lastSig="";
const esc=s=>(s||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

function render(force){
  // Only rebuild the grid when the data or filter actually changed. A blind 5s
  // innerHTML wipe destroys in-flight <img> loads (961KB Shopify photos never
  // finish before the next wipe), so the thumbnails stayed blank. Signature-gate it.
  const sig=filter+"|"+cards.map(c=>c.file+c.status+c.approved+c.state).join("|");
  if(!force && sig===lastSig) return;
  lastSig=sig;
  const f=document.getElementById("filters");
  f.innerHTML=FILTERS.map(([k,l])=>\`<button class="\${k===filter?'on':''}" onclick="setFilter('\${k}')">\${l}</button>\`).join("");
  const shown=cards.filter(c=>{
    if(filter==="all")return true;
    if(filter==="actionable")return (c.status==="pending"||c.status==="approved")||c.state==="needs-review"||c.orphaned;
    if(filter==="ready")return c.state==="ready";
    if(filter==="blocked")return c.state==="blocked"||c.state==="needs-review";
    if(filter==="scheduled")return c.status==="scheduled"||c.state==="shipping";
    if(filter==="skipped")return c.status==="skipped";
    return true;
  });
  const g=document.getElementById("grid");
  if(!shown.length){g.innerHTML='<div class="empty">Nothing here.</div>';return;}
  g.innerHTML=shown.map(card).join("");
}
function card(c){
  const terminal=["scheduled","skipped","needs-review","shipping"].includes(c.state);
  const canApprove=c.state==="ready"||c.state==="unknown";
  const disabled=!!c.escalation||!canApprove;
  const chips=[c.brand,c.platforms.join(" + "),c.grade&&('★ '+c.grade.split(' ')[0]),c.runId&&('run '+c.runId.slice(0,8)),c.source]
    .filter(Boolean).map((x,i)=>\`<span class="chip \${/★/.test(x)?'grade':''}">\${esc(x)}</span>\`).join("");
  const age=c.ageDays!=null?\`<span class="chip">\${c.ageDays}d old</span>\`:"";
  return \`<div class="card \${c.orphaned?'orphaned':c.state}">
    <div class="thumb">\${c.media?\`<img src="\${esc(c.media)}" onerror="this.parentNode.innerHTML='<span class=none>image unreachable</span>'">\`:'<span class="none">no media</span>'}</div>
    <div class="body">
      <div class="chips">\${chips}\${age}</div>
      <div class="verdict"><span class="dot"></span>\${esc(c.verdict)}</div>
      \${c.escalation?\`<div class="escalation"><b>Escalation — resolve before approving</b>\${esc(c.escalation)}</div>\`:""}
      \${c.copy?\`<div class="copy" id="copy-\${esc(c.slug)}">\${esc(c.copy)}</div>
        <button class="expand" onclick="document.getElementById('copy-\${esc(c.slug)}').classList.toggle('open');this.remove()">Read full copy</button>\`:'<div class="verdict" style="color:var(--bad)">no publishable copy</div>'}
      <div class="actions">
        \${c.orphaned?\`<div class="orphan"><div class="orphan-msg">⚠️ \${esc(c.verdict)}</div><button class="approve" onclick="act('requeue','\${esc(c.file)}')">Re-queue</button></div>\`:
          c.state==="scheduled"?\`<div class="sched"><div class="sched-when">\${esc(c.verdict)}</div>\${c.postIds.length?\`<a href="https://my.blotato.com/scheduler" target="_blank" rel="noopener">View / reschedule on Blotato ↗</a>\`:""}</div>\`:
          terminal?\`<div class="terminal-tag">\${esc(c.verdict)}</div>\`:
          (c.approved===true?\`<div class="approved-tag">✓ Approved — posts to \${esc(c.platforms.join(", "))} within 15 min</div><button class="skip" onclick="act('skip','\${esc(c.file)}')" style="grid-column:1/-1">Undo (skip)</button>\`:
          \`<button class="approve" \${disabled?'disabled':''} onclick="act('approve','\${esc(c.file)}')">Approve</button>
           <button class="skip" onclick="act('skip','\${esc(c.file)}')">Skip</button>\`)}
      </div>
    </div>
  </div>\`;
}
async function act(kind,file){
  await fetch('/api/'+kind,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({file})});
  await load();
}

// ── intake (+ New post) ──
let intakeFile=null;
function openIntake(){document.getElementById('overlay').classList.add('on');}
function closeIntake(){document.getElementById('overlay').classList.remove('on');intakeFile=null;document.getElementById('preview').innerHTML='';document.getElementById('dropText').textContent='Tap to choose a photo';document.getElementById('drop').classList.remove('has');document.getElementById('hint').value='';document.getElementById('istatus').textContent='';}
function pickFile(input){
  const f=input.files[0]; if(!f) return;
  intakeFile=f;
  document.getElementById('dropText').textContent=f.name;
  document.getElementById('drop').classList.add('has');
  const r=new FileReader(); r.onload=e=>{document.getElementById('preview').innerHTML='<img src="'+e.target.result+'">';}; r.readAsDataURL(f);
}
async function submitIntake(){
  const hint=document.getElementById('hint').value.trim();
  const st=document.getElementById('istatus'); const btn=document.getElementById('genBtn');
  if(!intakeFile){st.textContent='Choose a photo first.';return;}
  if(!hint){st.textContent='Tell me what it is.';return;}
  btn.disabled=true; st.textContent='Uploading photo + writing copy… (~15s)';
  try{
    const base64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(',')[1]);r.onerror=rej;r.readAsDataURL(intakeFile);});
    const resp=await fetch('/api/intake',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({hint,filename:intakeFile.name,contentType:intakeFile.type||'image/jpeg',base64})});
    const d=await resp.json();
    if(d.ok){st.textContent='Draft created ✓'; closeIntake(); filter='actionable'; await load(); render(true);}
    else{st.textContent='Failed: '+(d.error||'unknown');}
  }catch(e){st.textContent='Failed: '+e.message;}
  finally{btn.disabled=false;}
}
function setFilter(k){filter=k;render(true);}
async function load(){
  const r=await fetch('/api/queue');const d=await r.json();
  cards=d.cards;
  const s=d.summary;
  document.getElementById("summary").innerHTML=
    \`<span><b>\${s.waiting}</b> waiting</span>\`+
    (s.oldestDays?\` <span class="\${s.oldestDays>=3?'stale':''}"><b>\${s.oldestDays}d</b> oldest</span>\`:"")+
    \` <span>Blotato: <b>\${s.connected?s.connected.join(', '):'not connected'}</b></span>\`;
  render();
}
load(); setInterval(load, 5000);
</script>
</body></html>`;
