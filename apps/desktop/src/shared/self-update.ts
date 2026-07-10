export const SELF_UPDATE_STATUS = {
	IDLE: "idle",
	CHECKING: "checking",
	BEHIND: "behind",
	UPDATING: "updating",
	ERROR: "error",
} as const;

export type SelfUpdateStatus =
	(typeof SELF_UPDATE_STATUS)[keyof typeof SELF_UPDATE_STATUS];

export type SelfUpdateEvent = {
	status: SelfUpdateStatus;
	behindCount?: number;
	compareUrl?: string;
	error?: string;
};

/**
 * Pure classification of update state from git facts.
 * - installedCommit "dev"/"" → we can't count; if origin differs, treat as BEHIND (unknown count).
 * - behindCount > 0 → BEHIND with the count.
 * - otherwise IDLE (up to date, or local is ahead).
 */
export function deriveUpdateState(
	installedCommit: string,
	originCommit: string,
	behindCount: number,
): SelfUpdateEvent {
	if (!installedCommit || installedCommit === "dev") {
		return installedCommit && originCommit && installedCommit === originCommit
			? { status: SELF_UPDATE_STATUS.IDLE, behindCount: 0 }
			: { status: SELF_UPDATE_STATUS.BEHIND };
	}
	if (behindCount > 0) {
		return { status: SELF_UPDATE_STATUS.BEHIND, behindCount };
	}
	return { status: SELF_UPDATE_STATUS.IDLE, behindCount: 0 };
}
