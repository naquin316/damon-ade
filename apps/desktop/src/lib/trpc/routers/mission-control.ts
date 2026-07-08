import { readDashboards } from "main/lib/mission-control/config";
import { publicProcedure, router } from "..";

export const createMissionControlRouter = () => {
	return router({
		getDashboards: publicProcedure.query(() => readDashboards()),
	});
};
