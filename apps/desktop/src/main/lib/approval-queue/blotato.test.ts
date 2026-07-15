import { describe, expect, test } from "bun:test";
import {
	buildPostBody,
	createPost,
	indexAccounts,
	listAccounts,
	uploadMedia,
} from "./blotato";

function fakeFetch(
	handler: (
		url: string,
		init?: RequestInit,
	) => { status?: number; body?: unknown },
) {
	const calls: { url: string; init?: RequestInit }[] = [];
	const fn = (async (url: string | URL | Request, init?: RequestInit) => {
		const u = String(url);
		calls.push({ url: u, init });
		const { status = 200, body = {} } = handler(u, init);
		return {
			ok: status >= 200 && status < 300,
			status,
			json: async () => body,
			text: async () => JSON.stringify(body),
		} as unknown as Response;
	}) as unknown as typeof globalThis.fetch;
	return { fn, calls };
}

const KEY = "blt_test";

describe("buildPostBody — shape verified against the live API", () => {
	test("scheduledTime is ROOT-level, not inside post", () => {
		const b = buildPostBody({
			accountId: "6789",
			platform: "instagram",
			text: "hi",
			mediaUrls: ["https://x/y.png"],
			scheduledTime: "2026-07-20T15:30:00.000Z",
		}) as Record<string, unknown>;

		expect(b.scheduledTime).toBe("2026-07-20T15:30:00.000Z");
		expect((b.post as Record<string, unknown>).scheduledTime).toBeUndefined();
	});

	test("platform appears on BOTH content.platform and target.targetType", () => {
		const b = buildPostBody({
			accountId: "6789",
			platform: "instagram",
			text: "hi",
			mediaUrls: [],
			scheduledTime: "2026-07-20T15:30:00.000Z",
		}) as {
			post: {
				content: Record<string, unknown>;
				target: Record<string, unknown>;
			};
		};

		expect(b.post.content.platform).toBe("instagram");
		expect(b.post.target.targetType).toBe("instagram");
	});

	test("facebook carries pageId on target", () => {
		const b = buildPostBody({
			accountId: "5179",
			platform: "facebook",
			text: "hi",
			mediaUrls: [],
			scheduledTime: "2026-07-20T15:30:00.000Z",
			pageId: "page1",
		}) as { post: { target: Record<string, unknown> } };

		expect(b.post.target.pageId).toBe("page1");
	});

	// An earlier scrape hallucinated these from a 404 page. They are not in the real
	// contract; sending them is unverified guesswork.
	test("does not send the hallucinated publishType / platformRequirements", () => {
		const b = buildPostBody({
			accountId: "1",
			platform: "threads",
			text: "hi",
			mediaUrls: [],
			scheduledTime: "2026-07-20T15:30:00.000Z",
		}) as Record<string, unknown>;
		const post = b.post as Record<string, unknown>;

		expect(b.publishType).toBeUndefined();
		expect(post.publishType).toBeUndefined();
		expect(post.platformRequirements).toBeUndefined();
	});
});

describe("createPost — the response shape that bit us live", () => {
	// MEASURED 2026-07-14: the live API answers {"postSubmissionId":"<uuid>"}.
	// The first live run POSTed fine, didn't recognise this field, threw, and parked
	// the note at needs-review — while a real post sat scheduled on Instagram.
	test("reads postSubmissionId", async () => {
		const { fn } = fakeFetch(() => ({
			body: { postSubmissionId: "dee0fc26-cbc1-4c99" },
		}));
		const r = await createPost(
			{ fetch: fn, apiKey: KEY },
			{
				accountId: "6789",
				platform: "instagram",
				text: "hi",
				mediaUrls: [],
				scheduledTime: "2026-07-20T15:30:00.000Z",
			},
		);
		expect(r.id).toBe("dee0fc26-cbc1-4c99");
	});

	test("still accepts a plain id, in case the API changes", async () => {
		const { fn } = fakeFetch(() => ({ body: { id: "abc" } }));
		const r = await createPost(
			{ fetch: fn, apiKey: KEY },
			{
				accountId: "1",
				platform: "threads",
				text: "hi",
				mediaUrls: [],
				scheduledTime: "2026-07-20T15:30:00.000Z",
			},
		);
		expect(r.id).toBe("abc");
	});

	// Better to escalate than to record a success we can't evidence.
	test("throws when no recognisable id comes back", async () => {
		const { fn } = fakeFetch(() => ({ body: { weird: true } }));
		await expect(
			createPost(
				{ fetch: fn, apiKey: KEY },
				{
					accountId: "1",
					platform: "threads",
					text: "hi",
					mediaUrls: [],
					scheduledTime: "2026-07-20T15:30:00.000Z",
				},
			),
		).rejects.toThrow(/no post id/);
	});

	test("a non-2xx surfaces the status and body", async () => {
		const { fn } = fakeFetch(() => ({
			status: 401,
			body: { message: "Unauthorized" },
		}));
		await expect(
			createPost(
				{ fetch: fn, apiKey: KEY },
				{
					accountId: "1",
					platform: "threads",
					text: "hi",
					mediaUrls: [],
					scheduledTime: "2026-07-20T15:30:00.000Z",
				},
			),
		).rejects.toThrow(/401/);
	});

	test("sends the api key header and hits backend.blotato.com", async () => {
		const { fn, calls } = fakeFetch(() => ({
			body: { postSubmissionId: "x" },
		}));
		await createPost(
			{ fetch: fn, apiKey: KEY },
			{
				accountId: "1",
				platform: "threads",
				text: "hi",
				mediaUrls: [],
				scheduledTime: "2026-07-20T15:30:00.000Z",
			},
		);
		expect(calls[0]?.url).toBe("https://backend.blotato.com/v2/posts");
		expect(
			(calls[0]?.init?.headers as Record<string, string>)["blotato-api-key"],
		).toBe(KEY);
	});
});

describe("uploadMedia — photo -> Blotato URL (the intake first step)", () => {
	function mediaFetch() {
		const calls: {
			url: string;
			method: string;
			headers: Record<string, string>;
			body: unknown;
		}[] = [];
		const fn = (async (url: string, init?: RequestInit) => {
			const u = String(url);
			calls.push({
				url: u,
				method: init?.method ?? "GET",
				headers: (init?.headers ?? {}) as Record<string, string>,
				body: init?.body,
			});
			if (u.endsWith("/media/uploads")) {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						presignedUrl: "https://s3.example/put?sig=abc",
						publicUrl: "https://database.blotato.com/x/photo.jpg",
					}),
					text: async () => "",
				} as unknown as Response;
			}
			return {
				ok: true,
				status: 200,
				json: async () => ({}),
				text: async () => "",
			} as unknown as Response;
		}) as unknown as typeof globalThis.fetch;
		return { fn, calls };
	}

	test("presigns, PUTs the bytes, and returns publicUrl", async () => {
		const { fn, calls } = mediaFetch();
		const bytes = new Uint8Array([1, 2, 3]);
		const r = await uploadMedia(
			{ fetch: fn, apiKey: KEY },
			{ bytes, filename: "photo.jpg", contentType: "image/jpeg" },
		);

		expect(r.publicUrl).toBe("https://database.blotato.com/x/photo.jpg");
		expect(calls[0]?.url).toBe("https://backend.blotato.com/v2/media/uploads");
		expect(JSON.parse(String(calls[0]?.body))).toEqual({
			filename: "photo.jpg",
		});
		expect(calls[1]?.url).toBe("https://s3.example/put?sig=abc");
		expect(calls[1]?.method).toBe("PUT");
	});

	// The presigned PUT is a signed S3-style URL; sending the blotato-api-key header
	// can break the signature. It must carry only Content-Type.
	test("the PUT does NOT include the blotato-api-key header", async () => {
		const { fn, calls } = mediaFetch();
		await uploadMedia(
			{ fetch: fn, apiKey: KEY },
			{
				bytes: new Uint8Array([1]),
				filename: "p.png",
				contentType: "image/png",
			},
		);
		expect(
			(calls[1]?.headers as Record<string, string>)["blotato-api-key"],
		).toBeUndefined();
		expect((calls[1]?.headers as Record<string, string>)["Content-Type"]).toBe(
			"image/png",
		);
	});

	test("a presign response missing fields throws", async () => {
		const fn = (async () =>
			({
				ok: true,
				status: 200,
				json: async () => ({}),
				text: async () => "",
			}) as unknown as Response) as unknown as typeof globalThis.fetch;
		expect(
			uploadMedia(
				{ fetch: fn, apiKey: KEY },
				{
					bytes: new Uint8Array([1]),
					filename: "p.jpg",
					contentType: "image/jpeg",
				},
			),
		).rejects.toThrow(/missing/);
	});
});

describe("listAccounts / indexAccounts", () => {
	test("reads the items array and indexes by platform", async () => {
		const { fn, calls } = fakeFetch(() => ({
			body: {
				items: [
					{ id: "5179", platform: "facebook" },
					{ id: "6789", platform: "instagram", name: "handlanedesigns" },
				],
			},
		}));
		const accounts = await listAccounts({ fetch: fn, apiKey: KEY });
		expect(accounts).toHaveLength(2);
		expect(calls[0]?.url).toBe(
			"https://backend.blotato.com/v2/users/me/accounts",
		);

		const idx = indexAccounts(accounts);
		expect(idx.get("instagram")?.id).toBe("6789");
		// Ryan has no x account — this absence is what drives blocked: no-connected-account.
		expect(idx.get("x")).toBeUndefined();
	});

	test("first account per platform wins", () => {
		const idx = indexAccounts([
			{ id: "1", platform: "instagram" },
			{ id: "2", platform: "instagram" },
		]);
		expect(idx.get("instagram")?.id).toBe("1");
	});
});
