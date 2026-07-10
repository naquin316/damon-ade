import { BUILD_INFO } from "shared/build-info.generated";
import { publicProcedure, router } from "..";

export const createAppInfoRouter = () => {
	return router({
		get: publicProcedure.query(() => BUILD_INFO),
	});
};
