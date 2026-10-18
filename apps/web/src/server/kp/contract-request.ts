import { z } from "zod";

const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/).refine(value => !["__proto__", "prototype", "constructor"].includes(value));
export const contractSourceRefSchema = z.object({ proposalId: id, expectedRevision: z.number().int().nonnegative() }).strict();
const base = { documentId: id, expectedRevision: z.number().int().nonnegative(), operationId: z.uuid(), clientBaseline: z.string().regex(/^[a-f0-9]{64}$/),
  sourceRefs: z.array(contractSourceRefSchema).min(1).max(100) };
export const contractDraftRequestSchema = z.object({ ...base, settings: z.record(z.string(), z.unknown()) }).strict();
export const contractExportRequestSchema = z.object(base).strict();
export type ContractDraftRequest = z.infer<typeof contractDraftRequestSchema>;
export type ContractExportRequest = z.infer<typeof contractExportRequestSchema>;
