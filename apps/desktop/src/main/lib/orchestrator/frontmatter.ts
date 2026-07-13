import { parse, stringify } from "yaml";

const FM = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

export function splitFrontmatter(raw: string): { data: unknown; body: string } {
	const m = raw.match(FM);
	if (!m) return { data: {}, body: raw };
	try {
		return { data: parse(m[1]) ?? {}, body: m[2] ?? "" };
	} catch {
		return { data: {}, body: raw };
	}
}

export function joinFrontmatter(data: unknown, body: string): string {
	return `---\n${stringify(data)}---\n${body}`;
}
