import { useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { SELF_UPDATE_STATUS, type SelfUpdateEvent } from "shared/self-update";
import { formatBadgeLabel } from "./format";

export function VersionBadge() {
	const { data: info } = electronTrpc.appInfo.get.useQuery();
	const [event, setEvent] = useState<SelfUpdateEvent>({
		status: SELF_UPDATE_STATUS.IDLE,
	});
	const [open, setOpen] = useState(false);

	electronTrpc.selfUpdate.subscribe.useSubscription(undefined, {
		onData: (e) => setEvent(e),
	});
	const check = electronTrpc.selfUpdate.check.useMutation();
	const update = electronTrpc.selfUpdate.update.useMutation();

	if (!info) return null;

	const behind = event.status === SELF_UPDATE_STATUS.BEHIND;
	const busy =
		event.status === SELF_UPDATE_STATUS.CHECKING ||
		event.status === SELF_UPDATE_STATUS.UPDATING;

	return (
		<div className="no-drag relative">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className={`text-xs px-2 py-1 rounded font-medium transition-colors ${
					behind
						? "text-amber-600 dark:text-amber-400 hover:bg-muted"
						: "text-muted-foreground hover:bg-muted"
				}`}
				title="Version & updates"
			>
				{formatBadgeLabel(info, event)}
			</button>

			{open && (
				<div className="absolute right-0 top-full mt-1 w-64 rounded-md border border-border bg-popover p-3 shadow-md z-50 text-xs">
					<div className="font-medium text-sm">RyanOS v{info.version}</div>
					<div className="text-muted-foreground mt-0.5">
						{info.branch} · {info.commit}
						{info.buildDate ? ` · ${info.buildDate}` : ""}
					</div>
					{event.status === SELF_UPDATE_STATUS.ERROR && event.error && (
						<div className="mt-2 text-red-500 break-words">{event.error}</div>
					)}
					<div className="mt-3 flex items-center gap-2">
						<button
							type="button"
							disabled={busy}
							onClick={() => check.mutate()}
							className="px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-50"
						>
							{event.status === SELF_UPDATE_STATUS.CHECKING
								? "Checking…"
								: "Check for updates"}
						</button>
						{behind && (
							<button
								type="button"
								disabled={busy}
								onClick={() => update.mutate()}
								className="px-2 py-1 rounded bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
							>
								Update & relaunch
							</button>
						)}
					</div>
					{behind && event.compareUrl && (
						<a
							href={event.compareUrl}
							target="_blank"
							rel="noreferrer"
							className="mt-2 block text-muted-foreground underline"
						>
							{event.behindCount
								? `View ${event.behindCount} commits`
								: "View changes"}
						</a>
					)}
				</div>
			)}
		</div>
	);
}
