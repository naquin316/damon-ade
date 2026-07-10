import type { BuildInfo } from "shared/build-info.generated";
import { SELF_UPDATE_STATUS, type SelfUpdateEvent } from "shared/self-update";

export function formatBadgeLabel(
	info: BuildInfo,
	event: SelfUpdateEvent,
): string {
	const base = `v${info.version} · ${info.commit}`;
	switch (event.status) {
		case SELF_UPDATE_STATUS.UPDATING:
			return `v${info.version} · updating…`;
		case SELF_UPDATE_STATUS.CHECKING:
			return `${base} · checking…`;
		case SELF_UPDATE_STATUS.BEHIND:
			return event.behindCount && event.behindCount > 0
				? `${base} · ↑ ${event.behindCount} behind`
				: `${base} · ↑ update`;
		default:
			return base;
	}
}
