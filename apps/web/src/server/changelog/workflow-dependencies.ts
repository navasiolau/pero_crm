import type { Prisma } from "@prisma/client";
import { JournalReversalRefusal } from "./reversal-contract";
import { payrollAccrualReversal } from "@/server/payroll/accrual-reversal";

export async function workflowDependencies(tx: Prisma.TransactionClient, projectId: string, productId: string | null = null) {
  const [stamp] = await tx.$queryRaw<{ value: string }[]>`
    SELECT md5(jsonb_build_array(
      (SELECT jsonb_build_array(p.stage,p."workflowRevision") FROM "Project" p WHERE id=${projectId} AND ${productId}::text IS NOT NULL),
      (SELECT array_agg(to_jsonb(t) ORDER BY t.id) FROM "Task" t WHERE t."projectId"=${projectId} AND (${productId}::text IS NULL OR t."productId"=${productId})),
      (SELECT array_agg(to_jsonb(w) ORDER BY w.id) FROM "Work" w WHERE w."projectId"=${projectId} AND (${productId}::text IS NULL OR w."productId"=${productId})),
      (SELECT array_agg(to_jsonb(p) ORDER BY p.id) FROM "Payment" p WHERE p."projectId"=${projectId}),
      (SELECT array_agg(to_jsonb(m) ORDER BY m.id) FROM "ProjectMaterial" m JOIN "Product" i ON i.id=m."productId"
        WHERE i."projectId"=${projectId} AND (${productId}::text IS NULL OR i.id=${productId})),
      (SELECT array_agg(jsonb_build_array(i.id,i.status,i."workflowRevision",i."engineerId",i."assemblerId",i."mounterId",i."deletedAt") ORDER BY i.id)
        FROM "Product" i WHERE i."projectId"=${projectId} AND ${productId}::text IS NULL),
      (SELECT array_agg(to_jsonb(e) ORDER BY e.id) FROM "PayrollEntry" e WHERE e."projectId"=${projectId} AND e."compensatesId" IS NULL
        AND (${productId}::text IS NULL OR e."productId"=${productId})),
      (SELECT array_agg(to_jsonb(c) ORDER BY c.id) FROM "ProductPercentageCompletion" c JOIN "Product" i ON i.id=c."productId"
        WHERE i."projectId"=${projectId} AND (${productId}::text IS NULL OR i.id=${productId}))
    )::text) AS value`;
  if (!stamp) throw new Error("WORKFLOW_DEPENDENCY_STAMP_MISSING");
  return stamp.value;
}

export function readWorkflowCompensation(data: unknown) {
  if (data === null) return null;
  const handler = payrollAccrualReversal.read(data);
  if (!handler) throw new JournalReversalRefusal("Не удалось проверить связанные начисления");
  return handler;
}
