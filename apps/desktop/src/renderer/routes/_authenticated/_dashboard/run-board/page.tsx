import { createFileRoute } from "@tanstack/react-router";
import { RunBoardView } from "renderer/screens/main/components/RunBoard";

export const Route = createFileRoute("/_authenticated/_dashboard/run-board/")({
	component: RunBoardView,
});
