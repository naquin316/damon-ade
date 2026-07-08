import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { useEffect, useRef, useState } from "react";
import { LuExternalLink } from "react-icons/lu";
import { TbLoader2, TbRefresh } from "react-icons/tb";
import type { Dashboard } from "shared/mission-control-types";

type Status = "loading" | "live" | "unreachable";

const STATUS_DOT: Record<Status, { dot: string; ping?: string }> = {
	loading: { dot: "bg-amber-500", ping: "bg-amber-400" },
	live: { dot: "bg-green-500" },
	unreachable: { dot: "bg-red-500", ping: "bg-red-400" },
};

const UNREACHABLE_HINT: Record<Dashboard["kind"], string> = {
	lan: "On the home network?",
	localhost: "Local server running?",
	web: "Check the URL / login.",
	file: "File not found.",
};

interface DashboardTileProps {
	dashboard: Dashboard;
}

export function DashboardTile({ dashboard }: DashboardTileProps) {
	const ref = useRef<Electron.WebviewTag | null>(null);
	const [status, setStatus] = useState<Status>("loading");
	// Bumped on Retry to remount the <webview> and force a fresh load.
	const [nonce, setNonce] = useState(0);
	// Tracks whether the current load already failed. When a main-frame load
	// fails (e.g. connection refused), Chromium then renders its own error page,
	// which fires did-finish-load — without this guard, onFinish would overwrite
	// "unreachable" back to "live" and the tile would show blank-but-green
	// instead of the Retry overlay. Reset at the start of each load.
	const failedRef = useRef(false);

	useEffect(() => {
		const wv = ref.current;
		if (!wv) return;

		const onStart = () => {
			failedRef.current = false;
			setStatus("loading");
		};
		const onFinish = () => {
			// Don't let the error-page load flip a failed tile back to "live".
			if (!failedRef.current) setStatus("live");
		};
		const onFail = (e: Electron.DidFailLoadEvent) => {
			// -3 = ERR_ABORTED — fires on normal in-page/cancelled navigations, not a real failure.
			// isMainFrame guard: a failed sub-frame (iframe/widget) inside an otherwise-live
			// dashboard must NOT flip the whole tile to unreachable (did-finish-load only fires
			// for the main frame, so it'd get stuck). Only the top-level document counts.
			if (e.errorCode !== -3 && e.isMainFrame) {
				failedRef.current = true;
				setStatus("unreachable");
			}
		};

		wv.addEventListener("did-start-loading", onStart);
		wv.addEventListener("did-finish-load", onFinish);
		wv.addEventListener("did-fail-load", onFail);

		return () => {
			wv.removeEventListener("did-start-loading", onStart);
			wv.removeEventListener("did-finish-load", onFinish);
			wv.removeEventListener("did-fail-load", onFail);
		};
	}, [nonce]);

	const retry = () => {
		setStatus("loading");
		setNonce((n) => n + 1);
	};

	const popOut = () => window.open(dashboard.url, "_blank");

	return (
		<div className="flex h-full flex-col overflow-hidden rounded-lg border border-border/50 bg-background/50">
			<div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-3 py-1.5 text-sm">
				<span className="relative flex size-2 shrink-0">
					{STATUS_DOT[status].ping && (
						<span
							className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${STATUS_DOT[status].ping}`}
						/>
					)}
					<span
						className={`relative inline-flex size-2 rounded-full ${STATUS_DOT[status].dot}`}
					/>
				</span>
				<span className="truncate font-medium text-foreground">
					{dashboard.name}
				</span>
				<span className="ml-auto flex items-center gap-0.5">
					<Tooltip>
						<TooltipTrigger asChild>
							<button
								type="button"
								onClick={retry}
								className="rounded p-1 text-muted-foreground/60 transition-colors hover:text-muted-foreground"
							>
								{status === "loading" ? (
									<TbLoader2 className="size-3.5 animate-spin" />
								) : (
									<TbRefresh className="size-3.5" />
								)}
							</button>
						</TooltipTrigger>
						<TooltipContent side="bottom" showArrow={false}>
							{status === "loading" ? "Loading..." : "Reload"}
						</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<button
								type="button"
								onClick={popOut}
								className="rounded p-1 text-muted-foreground/60 transition-colors hover:text-muted-foreground"
							>
								<LuExternalLink className="size-3.5" />
							</button>
						</TooltipTrigger>
						<TooltipContent side="bottom" showArrow={false}>
							Open externally
						</TooltipContent>
					</Tooltip>
				</span>
			</div>
			<div className="relative min-h-0 flex-1">
				{status === "unreachable" && (
					<div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background/95 px-4 text-center text-sm">
						<span className="text-muted-foreground/70">
							Unreachable — {UNREACHABLE_HINT[dashboard.kind]}
						</span>
						<span className="max-w-full truncate text-xs text-muted-foreground/40">
							{dashboard.url}
						</span>
						<button
							type="button"
							onClick={retry}
							className="rounded border border-border/60 px-3 py-1 text-xs text-muted-foreground/70 transition-colors hover:text-foreground"
						>
							Retry
						</button>
					</div>
				)}
				<webview
					key={nonce}
					ref={ref}
					src={dashboard.url}
					partition="persist:superset"
					style={{ display: "flex", flex: 1, width: "100%", height: "100%" }}
				/>
			</div>
		</div>
	);
}
