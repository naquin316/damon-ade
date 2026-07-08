import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { LuLayoutGrid } from "react-icons/lu";

export function MissionControlButton() {
	const navigate = useNavigate();
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const isActive = pathname.startsWith("/mission-control");

	return (
		<Tooltip delayDuration={300}>
			<TooltipTrigger asChild>
				<button
					type="button"
					onClick={() => navigate({ to: "/mission-control" })}
					aria-label="Mission Control"
					className={`no-drag flex items-center justify-center size-7 rounded-md transition-colors ${
						isActive
							? "text-foreground bg-accent/50"
							: "text-muted-foreground hover:text-foreground hover:bg-accent/50"
					}`}
				>
					<LuLayoutGrid className="size-4" strokeWidth={1.5} />
				</button>
			</TooltipTrigger>
			<TooltipContent side="bottom">Mission Control</TooltipContent>
		</Tooltip>
	);
}
