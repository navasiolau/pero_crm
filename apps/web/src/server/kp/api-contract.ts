import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { DomainActor } from "@/server/actor";
import type { KpApiScope } from "@/lib/kp-api-scopes";

export class KpApiError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); this.name = "KpApiError"; }
}
export const apiFailure = (code: string, status: number, message: string): never => { throw new KpApiError(code, status, message); };
export type KpActorBinding = { id: string; source: "web" | "api"; tokenId?: string; sessionVersion?: number };
export type KpApiContext = {
  actor: DomainActor; binding: KpActorBinding;
  authorize(scope?: KpApiScope, tx?: Prisma.TransactionClient): Promise<DomainActor>;
};
export type ApiAction = "listDocuments" | "createDocument" | "getDocument" | "saveDocument" | "changeClient" | "readOperation" |
  "upload" | "readMedia" | "listVersions" | "getVersion" | "restoreVersion" | "pdf" | "getContract" |
  "saveContract" | "generateContract" | "contractHistory" | "getJob" | "readArtifact" | "listClients" | "getClient" | "createClient" | "rates";
export type KpApiService = { execute(action: ApiAction, context: KpApiContext, input: Record<string, unknown>): Promise<unknown> };
export type ApiBinary = { bytes: Uint8Array; mimeType: string; fileName: string; disposition?: "inline" | "attachment" };
export const apiId = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const apiRevision = z.number().int().min(0).max(2_147_483_647);
export const apiOperationId = z.uuid().transform(value => value.toLowerCase());
export const apiChangeClient = z.object({ operationId: apiOperationId, expectedRevision: apiRevision, expectedClientId: apiId, clientId: apiId }).strict();
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Укажите календарную дату");
export const apiFx = z.object({ currency: z.enum(["BYN", "RUB", "USD", "EUR"]),
  rate: z.string().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,10})?$/).refine(value => Number(value) > 0),
  date: calendarDate, source: z.enum(["NBRB", "MANUAL"]) }).strict();
const state = z.record(z.string(), z.json()).refine(value => Array.isArray(value.items), "Нужен состав КП");
const clientSnapshot = z.object({ name: z.string().min(1), lastName: z.string().nullable(), middleName: z.string().nullable(), phone: z.string().min(1),
  email: z.string().nullable(), address: z.string().nullable(), comment: z.string().nullable(), passportNumber: z.string().nullable(), passportIssuedBy: z.string().nullable() }).partial().strict();
const write = { operationId: apiOperationId, state, clientId: apiId.optional(), clientSnapshot: clientSnapshot.optional(), address: z.string().nullable().optional(), fx: apiFx.optional() };
export const apiCreateDocument = z.object({ ...write, expectedNumber: z.number().int().positive().max(2_147_483_647).optional() }).strict();
export const apiSaveDocument = z.object({ ...write, expectedRevision: apiRevision, proposalId: apiId.optional() }).strict();
export const apiRelease = z.object({ operationId: apiOperationId, expectedRevision: apiRevision, proposalId: apiId.optional() }).strict();
export const apiRestore = z.object({ operationId: apiOperationId, expectedRevision: apiRevision }).strict();
const sourceRefs = z.array(z.object({ proposalId: apiId, expectedRevision: apiRevision }).strict()).min(1).max(30);
const contract = { documentId: apiId, expectedRevision: apiRevision, operationId: apiOperationId,
  clientBaseline: z.string().regex(/^[a-f0-9]{64}$/), sourceRefs };
export const apiSaveContract = z.object({ ...contract, settings: z.record(z.string(), z.json()) }).strict();
export const apiGenerateContract = z.object(contract).strict();
export const apiRateQuery = z.object({ currency: z.enum(["BYN", "RUB", "USD", "EUR"]), date: calendarDate }).strict();
export function parseApi<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return apiFailure("KP_REQUEST_INVALID", 400, parsed.error.issues[0]?.message ?? "Проверьте запрос КП");
  return parsed.data;
}
