export type Spawner = (opts: { agentId: string; command: string; label: string }) => void;
export type SlugResolver = (slug: string) => string | null;

export function dispatchAgent(
	deps: { resolveSlug: SlugResolver; spawn: Spawner; buildCommand: (agentId: string) => string },
	slug: string,
	instruction: string,
): { ok: true } | { ok: false; error: string } {
	const agentId = deps.resolveSlug(slug);
	if (!agentId) return { ok: false, error: `No agent registered for slug: ${slug}` };
	// The instruction is delivered by appending it after the launch command as an
	// initial prompt argument. buildAgentLaunchCommand already ends with the claude
	// invocation; append a quoted -p/initial-prompt segment.
	const command = `${deps.buildCommand(agentId)} ${JSON.stringify(instruction)}`;
	deps.spawn({ agentId, command, label: `conductor:${slug}` });
	return { ok: true };
}
