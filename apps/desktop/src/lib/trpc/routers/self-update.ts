import { observable } from "@trpc/server/observable";
import {
	checkForUpdates,
	getSelfUpdateStatus,
	selfUpdateEmitter,
	startUpdate,
} from "main/lib/self-update";
import type { SelfUpdateEvent } from "shared/self-update";
import { publicProcedure, router } from "..";

export const createSelfUpdateRouter = () => {
	return router({
		subscribe: publicProcedure.subscription(() => {
			return observable<SelfUpdateEvent>((emit) => {
				emit.next(getSelfUpdateStatus());
				const onChange = (event: SelfUpdateEvent) => emit.next(event);
				selfUpdateEmitter.on("status-changed", onChange);
				return () => selfUpdateEmitter.off("status-changed", onChange);
			});
		}),
		getStatus: publicProcedure.query(() => getSelfUpdateStatus()),
		check: publicProcedure.mutation(async () => {
			await checkForUpdates();
		}),
		update: publicProcedure.mutation(() => {
			startUpdate();
		}),
	});
};
