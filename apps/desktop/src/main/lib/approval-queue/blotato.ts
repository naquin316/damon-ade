/**
 * Minimal Blotato REST client (RYA-166).
 *
 * WHY REST AND NOT THE MCP: Blotato's MCP (`https://mcp.blotato.com/mcp`)
 * authenticates by an interactive OAuth flow. A headless drain can never complete
 * it — proven, twice: the Agent SDK and `claude -p --strict-mcp-config` both report
 * `status: needs-auth` with zero blotato tools exposed, even with the
 * `blotato-api-key` header set. The REST API takes the same key in a header and
 * just works, so the drain talks to it directly: no agent, no MCP, no ~$0.50 Opus
 * session per post, and it's deterministic and testable.
 *
 * `api.blotato.com` is NOT a valid host (the docs say so explicitly, and it's the
 * hostname an LLM guesses). Base URL is `backend.blotato.com/v2`.
 */

export const BLOTATO_BASE_URL = "https://backend.blotato.com/v2";

/** Shape is deliberately open — the account payload carries platform-specific
 *  extras (e.g. a Facebook pageId) we pass through rather than model. */
export interface BlotatoAccount {
	id: string;
	platform: string;
	name?: string;
	pageId?: string;
	[key: string]: unknown;
}

export interface BlotatoDeps {
	fetch: typeof globalThis.fetch;
	apiKey: string;
	baseUrl?: string;
}

export interface CreatePostRequest {
	accountId: string;
	platform: string;
	text: string;
	mediaUrls: string[];
	/** ISO-8601. Always sent: the drain never publishes-now, so an approval always
	 *  leaves a cancellable window in Blotato's scheduler. */
	scheduledTime: string;
	/** Facebook requires a page id on `target`. */
	pageId?: string;
	/** Pinterest requires a board id on `target`. */
	boardId?: string;
}

function headers(deps: BlotatoDeps): Record<string, string> {
	return { "blotato-api-key": deps.apiKey, "Content-Type": "application/json" };
}

async function readError(res: Response): Promise<string> {
	let body = "";
	try {
		body = (await res.text()).slice(0, 300);
	} catch {
		// body is best-effort; the status is the load-bearing part
	}
	return `HTTP ${res.status}${body ? `: ${body}` : ""}`;
}

export async function listAccounts(
	deps: BlotatoDeps,
): Promise<BlotatoAccount[]> {
	const res = await deps.fetch(
		`${deps.baseUrl ?? BLOTATO_BASE_URL}/users/me/accounts`,
		{
			headers: headers(deps),
		},
	);
	if (!res.ok) throw new Error(`listAccounts failed: ${await readError(res)}`);
	const json = (await res.json()) as unknown;
	const items = (json as { items?: unknown }).items ?? json;
	if (!Array.isArray(items))
		throw new Error("listAccounts: unexpected payload shape");
	return items as BlotatoAccount[];
}

/**
 * Body shape is verbatim from the docs' `?ask=` interface, cross-checked against
 * /api/publish-post.md. Note `scheduledTime` is ROOT-level, not inside `post` —
 * and note what is NOT here: an earlier scrape produced a confident
 * `publishType` + `platformRequirements` schema that was pure hallucination from a
 * 404 page. Don't reintroduce them without seeing a 2xx.
 */
export function buildPostBody(req: CreatePostRequest): unknown {
	return {
		post: {
			accountId: req.accountId,
			content: {
				text: req.text,
				mediaUrls: req.mediaUrls,
				platform: req.platform,
			},
			target: {
				targetType: req.platform,
				...(req.pageId ? { pageId: req.pageId } : {}),
				...(req.boardId ? { boardId: req.boardId } : {}),
			},
		},
		scheduledTime: req.scheduledTime,
	};
}

/**
 * Create a scheduled post.
 *
 * The response is `{"postSubmissionId":"<uuid>"}` — MEASURED against the live API
 * 2026-07-14, not read off a doc. It is NOT `id`, and it is NOT the schedule id:
 * the same post appears under `GET /v2/schedules` with a separate numeric `id`
 * (e.g. 2560423), which is what `DELETE /v2/schedules/:id` takes. Two different
 * identifiers for one post; don't conflate them.
 */
export async function createPost(
	deps: BlotatoDeps,
	req: CreatePostRequest,
): Promise<{ id: string }> {
	const res = await deps.fetch(`${deps.baseUrl ?? BLOTATO_BASE_URL}/posts`, {
		method: "POST",
		headers: headers(deps),
		body: JSON.stringify(buildPostBody(req)),
	});
	if (!res.ok) throw new Error(`createPost failed: ${await readError(res)}`);
	const json = (await res.json()) as Record<string, unknown>;
	// Liberal about where the id lives, because guessing wrong here is expensive in
	// BOTH directions: the first live run POSTed successfully, failed to recognise
	// `postSubmissionId`, and threw — so a real post was scheduled while the note
	// was parked at needs-review. Fail-safe, but wrong. Never claim a success we
	// cannot evidence, and never miss one we actually got.
	const id =
		(json.postSubmissionId as string) ??
		(json.id as string) ??
		((json.post as Record<string, unknown> | undefined)?.id as string) ??
		((json.data as Record<string, unknown> | undefined)?.id as string);
	if (!id)
		throw new Error(
			`createPost: no post id in response: ${JSON.stringify(json).slice(0, 200)}`,
		);
	return { id: String(id) };
}

export interface BlotatoSchedule {
	id: string;
	draft?: { target?: { targetType?: string }; content?: { text?: string } };
	scheduledAt?: string;
	[key: string]: unknown;
}

/** Scheduled-but-unpublished posts. The `id` here is the SCHEDULE id — the one
 *  `deleteSchedule` takes, distinct from createPost's `postSubmissionId`. */
export async function listSchedules(
	deps: BlotatoDeps,
	limit = 25,
): Promise<BlotatoSchedule[]> {
	const res = await deps.fetch(
		`${deps.baseUrl ?? BLOTATO_BASE_URL}/schedules?limit=${limit}`,
		{
			headers: headers(deps),
		},
	);
	if (!res.ok) throw new Error(`listSchedules failed: ${await readError(res)}`);
	const json = (await res.json()) as unknown;
	const items = (json as { items?: unknown }).items ?? json;
	if (!Array.isArray(items))
		throw new Error("listSchedules: unexpected payload shape");
	return items as BlotatoSchedule[];
}

/** Cancel a scheduled post before it publishes. Returns 204. Not undoable. */
export async function deleteSchedule(
	deps: BlotatoDeps,
	scheduleId: string,
): Promise<void> {
	const res = await deps.fetch(
		`${deps.baseUrl ?? BLOTATO_BASE_URL}/schedules/${scheduleId}`,
		{
			method: "DELETE",
			headers: headers(deps),
		},
	);
	if (!res.ok)
		throw new Error(`deleteSchedule failed: ${await readError(res)}`);
}

/**
 * Upload a local image so it becomes a Blotato-hosted URL usable as a post's
 * `mediaUrls`. This is the intake front-door's first step: a phone photo isn't a URL,
 * and Blotato (like every platform API) needs one.
 *
 * Two hops, per the docs:
 *   1. POST /v2/media/uploads {filename} -> { presignedUrl, publicUrl }
 *   2. PUT the raw bytes to presignedUrl with the file's content-type
 * Then `publicUrl` is what goes into the post.
 */
export async function uploadMedia(
	deps: BlotatoDeps,
	file: { bytes: Uint8Array; filename: string; contentType: string },
): Promise<{ publicUrl: string }> {
	const base = deps.baseUrl ?? BLOTATO_BASE_URL;
	const presign = await deps.fetch(`${base}/media/uploads`, {
		method: "POST",
		headers: headers(deps),
		body: JSON.stringify({ filename: file.filename }),
	});
	if (!presign.ok)
		throw new Error(`uploadMedia presign failed: ${await readError(presign)}`);
	const { presignedUrl, publicUrl } = (await presign.json()) as {
		presignedUrl?: string;
		publicUrl?: string;
	};
	if (!presignedUrl || !publicUrl) {
		throw new Error(
			"uploadMedia: presign response missing presignedUrl/publicUrl",
		);
	}

	// The PUT goes to the presigned URL directly — NO blotato-api-key header (it's a
	// signed S3-style URL; adding auth headers can break the signature).
	const put = await deps.fetch(presignedUrl, {
		method: "PUT",
		headers: { "Content-Type": file.contentType },
		// Uint8Array is a valid fetch body at runtime; TS's BodyInit union is fussy
		// about the generic, so cast.
		body: file.bytes as unknown as BodyInit,
	});
	if (!put.ok)
		throw new Error(`uploadMedia PUT failed: ${await readError(put)}`);

	return { publicUrl };
}

/** platform -> account. First account per platform wins; the queue notes carry an
 *  explicit `accountId` when it matters. */
export function indexAccounts(
	accounts: BlotatoAccount[],
): Map<string, BlotatoAccount> {
	const m = new Map<string, BlotatoAccount>();
	for (const a of accounts) {
		const p = String(a.platform ?? "").toLowerCase();
		if (p && !m.has(p)) m.set(p, a);
	}
	return m;
}
