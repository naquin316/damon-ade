import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import { useState } from "react";
import { useSubmitGoal } from "renderer/react-query/orchestrator/hooks";

interface GoalInputProps {
	/** Fires as soon as submitGoal returns the "planning" manifest (does NOT
	 *  wait for the Conductor's plan — that arrives later over watchRun). */
	onSubmitted: (runId: string) => void;
}

export function GoalInput({ onSubmitted }: GoalInputProps) {
	const [goal, setGoal] = useState("");
	const submitGoal = useSubmitGoal();

	const handleSubmit = () => {
		const trimmed = goal.trim();
		if (!trimmed || submitGoal.isPending) return;
		submitGoal.mutate(
			{ goal: trimmed },
			{
				onSuccess: (run) => {
					// submitGoal now resolves as soon as the "planning" manifest is
					// written — it does not wait for the Conductor. Hand off to
					// watchRun immediately so the UI never blocks on this mutation.
					onSubmitted(run.run_id);
					setGoal("");
				},
			},
		);
	};

	return (
		<div className="flex flex-col gap-2 p-3 border-b border-border/50">
			<div className="flex items-center gap-2">
				<Input
					value={goal}
					onChange={(e) => setGoal(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") handleSubmit();
					}}
					placeholder="Describe the goal for the Conductor to plan…"
					disabled={submitGoal.isPending}
					className="flex-1"
				/>
				<Button
					onClick={handleSubmit}
					disabled={!goal.trim() || submitGoal.isPending}
				>
					{submitGoal.isPending ? "Planning…" : "Run"}
				</Button>
			</div>
			{submitGoal.isError && (
				<span className="text-xs text-destructive">
					{submitGoal.error instanceof Error
						? submitGoal.error.message
						: "Failed to submit goal"}
				</span>
			)}
		</div>
	);
}
