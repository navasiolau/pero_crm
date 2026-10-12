export type PostCommitEffect = { kind: "dispatch" | "person" | "org" | "payroll" | "cache"; run: () => unknown | Promise<unknown> };
const OPERATIONS = ["task-status", "payment-create", "product-cache", "product-update", "product-status", "work-create", "work-update", "work-delete", "material-norm-create", "material-norm-update", "material-norm-delete", "stock-movement", "stock-purchase", "warehouse-cache"] as const;
export type PostCommitOperation = typeof OPERATIONS[number];
type Diagnostic = { code: "POST_COMMIT_EFFECT_FAILED"; operation: string; resultId: string; effect: PostCommitEffect["kind"] };
const diagnose = (entry: Diagnostic) => console.error("[crm.post-commit]", entry);

/** Optional эффекты не подменяют ACK; audit/outbox должны быть сохранены до вызова. */
export async function deliverPostCommit(operation: PostCommitOperation, resultId: string, effects: PostCommitEffect[],
  report: (entry: Diagnostic) => unknown | Promise<unknown> = diagnose,
): Promise<void> {
  for (const effect of effects) {
    try { await effect.run(); }
    catch {
      try { await report({ code: "POST_COMMIT_EFFECT_FAILED", operation: (OPERATIONS as readonly string[]).includes(operation) ? operation : "operation",
        resultId: /^[A-Za-z0-9:_-]{1,160}$/.test(resultId) ? resultId : "unavailable", effect: effect.kind }); } catch { /* Диагностика также не меняет сохранённый результат. */ }
    }
  }
}
