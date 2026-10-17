import { z } from "zod";

export const DEFAULT_CASH_ACCOUNT_KEY = "defaultCashAccountId";
export const defaultCashAccountSnapshotSchema = z.object({
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
  accountId: z.string().trim().min(1).max(128).nullable(),
}).strict();
export type DefaultCashAccountSnapshot = z.infer<typeof defaultCashAccountSnapshotSchema>;
export const EMPTY_DEFAULT_CASH_ACCOUNT: DefaultCashAccountSnapshot = { revision: 0, accountId: null };
export const defaultCashAccountPatchSchema = z.object({
  accountId: z.string().trim().min(1).max(128).nullable(),
  expectedRevision: defaultCashAccountSnapshotSchema.shape.revision,
}).strict();
export type DefaultCashAccountPatch = z.input<typeof defaultCashAccountPatchSchema>;
export type DefaultCashAccountResult =
  | { ok: true; snapshot: DefaultCashAccountSnapshot }
  | { ok: false; error: string; kind: "forbidden" | "validation" | "conflict" | "failure"; current?: DefaultCashAccountSnapshot };
