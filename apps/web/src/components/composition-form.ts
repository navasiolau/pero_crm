export function compositionParentOptions<T extends { id: string; kind: string; parentId: string | null }>(rows: T[], editingId: string | null): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const insideEditedSubtree = (row: T) => {
    if (!editingId) return false;
    let current: T | undefined = row;
    while (current) {
      if (current.id === editingId) return true;
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return false;
  };
  return rows.filter((row) => row.kind === "MODULE" && !insideEditedSubtree(row));
}

export function parseCompositionQuantity(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) && quantity <= 1_000_000 ? quantity : null;
}

/** Keep the UUID when a confirmation result is uncertain; reset it only after a definitive reply. */
export function nextCompositionConfirmRequestId(existing: string | null, create: () => string): string {
  return existing ?? create();
}
