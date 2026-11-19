import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import { proposalExportRequestReversal } from "../src/server/kp/export-request-reversal";

test("generating leases block reversal and an untouched PDF request can be cancelled and reapplied", async () => {
  const row = { id: "job", kind: "PDF", proposalId: "proposal", attempts: 0, leaseOwner: null as string | null,
    state: "PENDING", lastErrorCode: null as string | null };
  const matches = (where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => row[key as keyof typeof row] === value);
  const tx = { $queryRaw: async () => [],
    proposalJob: { findFirst: async ({ where }: { where: Record<string, unknown> }) => matches(where) ? row : null,
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (!matches(where)) return { count: 0 };
        Object.assign(row, data); return { count: 1 };
      } },
  } as unknown as Prisma.TransactionClient;
  const ctx = { tx, actor: { id: "director", name: "Директор", roles: ["DIRECTOR" as const], source: "web" as const },
    entityId: "proposal", entryId: "request" };
  const command = proposalExportRequestReversal.command({ jobId: "job", ownerId: "proposal", kind: "PDF", cancel: true });
  const handler = proposalExportRequestReversal.read(command.data)!;
  row.leaseOwner = "worker";
  assert.match(await handler.preview(ctx) ?? "", /уже начат/);
  await assert.rejects(handler.apply(ctx), /уже начат/);
  row.leaseOwner = null;
  const cancelled = await handler.apply(ctx);
  assert.equal(row.state, "CANCELLED");
  await proposalExportRequestReversal.read(cancelled.reversal.data)!.apply(ctx);
  assert.equal(row.state, "PENDING");
});

