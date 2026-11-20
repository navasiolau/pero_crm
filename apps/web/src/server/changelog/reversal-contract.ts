import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import type { DomainActor } from "@/server/actor";
import type { JournalPresentationHints } from "./contract";

export type JournalReversalCommand = { kind: string; version: number; data: Prisma.InputJsonValue };
type ReversalContext = { tx: Prisma.TransactionClient; actor: DomainActor; entryId: string; reversalId?: string; entityId: string };
type ReversalEffect = {
  hints?: JournalPresentationHints;
  oldValue?: unknown;
  newValue?: unknown;
  cachePaths?: string[];
  eventIds?: string[];
  afterWrite?: (reversalId: string) => Promise<void>;
};

export class JournalReversalRefusal extends Error {
  constructor(message: string, readonly href?: string) { super(message); }
}

export function defineJournalReversal<T extends Prisma.InputJsonValue>(definition: {
  kind: string;
  version: number;
  schema: z.ZodType<T>;
  confirmation?: string;
  preview(ctx: ReversalContext, data: T): Promise<string | null>;
  apply(ctx: ReversalContext, data: T): Promise<ReversalEffect & { inverse: T }>;
}) {
  const { kind, version, schema } = definition;
  const command = (data: T): JournalReversalCommand => ({ kind, version, data: schema.parse(data) });
  return {
    kind, version, command,
    read(data: unknown) {
      const parsed = schema.safeParse(data);
      if (!parsed.success) return null;
      return {
        confirmation: definition.confirmation,
        preview: (ctx: ReversalContext) => definition.preview(ctx, parsed.data),
        async apply(ctx: ReversalContext) {
          const { inverse, ...effect } = await definition.apply(ctx, parsed.data);
          return { ...effect, reversal: command(inverse) };
        },
      };
    },
  };
}
