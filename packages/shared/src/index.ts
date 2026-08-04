// @makthab/shared — Zod schemas + inferred TS DTOs shared between client and server.
// Backend owns this package; Frontend consumes it. See BUILD_CONTRACT.md §4.

export * from "./schemas/common";
export * from "./schemas/auth";
export * from "./schemas/student";
export * from "./schemas/class";
export * from "./schemas/fee";
export * from "./schemas/attendance";
export * from "./schemas/finance";
export * from "./schemas/report";
export * from "./schemas/user";
export * from "./schemas/orgProfile";
export * from "./schemas/role";
export * from "./schemas/category";
export * from "./schemas/audit";
