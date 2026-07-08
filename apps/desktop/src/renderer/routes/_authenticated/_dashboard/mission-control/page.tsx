import { createFileRoute } from "@tanstack/react-router";
import { MissionControlView } from "renderer/screens/main/components/MissionControlView";

export const Route = createFileRoute(
	"/_authenticated/_dashboard/mission-control/",
)({
	component: MissionControlView,
});
