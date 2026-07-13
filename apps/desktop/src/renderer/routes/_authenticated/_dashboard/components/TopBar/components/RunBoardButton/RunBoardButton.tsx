import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { LuWorkflow } from "react-icons/lu";

export function RunBoardButton() {
	const navigate = useNavigate();
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const isActive = pathname.startsWith("/run-board");

	return (
		<Tooltip delayDuration={300}>
			<TooltipTrigger asChild>
				<button
					type="button"
					onClick={() => navigate({ to: "/run-board" })}
					aria-label="Run Board"
					className={`no-drag flex items-center justify-center size-7 rounded-md transition-colors ${
						isActive
							? "text-foreground bg-accent/50"
							: "text-muted-foreground hover:text-foreground hover:bg-accent/50"
					}`}
				>
					<LuWorkflow className="size-4" strokeWidth={1.5} />
				</button>
			</TooltipTrigger>
			<TooltipContent side="bottom">Run Board</TooltipContent>
		</Tooltip>
	);
}
