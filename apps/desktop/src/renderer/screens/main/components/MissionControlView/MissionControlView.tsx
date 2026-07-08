import { electronTrpc } from "renderer/lib/electron-trpc";

export function MissionControlView() {
	const { data: dashboards = [] } =
		electronTrpc.missionControl.getDashboards.useQuery();

	return (
		<div className="flex-1 flex flex-col bg-card overflow-hidden">
			<div className="flex items-center gap-3 px-4 py-2 border-b border-border/50">
				<span className="text-sm font-medium text-foreground">
					Mission Control
				</span>
				<span className="text-xs text-foreground/40">
					{dashboards.length}
				</span>
			</div>
			<div className="flex-1 overflow-auto p-3">
				<div
					className="grid gap-3"
					style={{
						gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
						gridAutoRows: "minmax(320px, 1fr)",
					}}
				>
					{dashboards.map((dashboard) => (
						// Task 3 replaces this placeholder with <DashboardTile dashboard={dashboard} />
						<div
							key={dashboard.id}
							className="flex flex-col gap-1 rounded-lg border border-border/50 bg-background/50 p-3 text-sm"
						>
							<span className="font-medium text-foreground truncate">
								{dashboard.name}
							</span>
							<span className="text-xs text-foreground/60 truncate">
								{dashboard.url}
							</span>
						</div>
					))}
				</div>

				{dashboards.length === 0 && (
					<div className="flex flex-col items-center justify-center h-32 text-foreground/40 text-sm px-4 text-center">
						<span>No dashboards configured</span>
					</div>
				)}
			</div>
		</div>
	);
}
