export type DashboardKind = "lan" | "localhost" | "web" | "file";

export interface Dashboard {
	id: string;
	name: string;
	url: string;
	kind: DashboardKind;
}
