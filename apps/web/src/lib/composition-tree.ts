export type CompositionKind = "MODULE" | "PART" | "HARDWARE";
export type CompositionTreeRow = {
  id: string;
  revisionId: string;
  lineageId: string;
  parentId: string | null;
  kind: CompositionKind;
  designation: string;
  title: string;
  quantityPerParent: number;
  travelsToInstallation: boolean;
};

export const COMPOSITION_LIMITS = Object.freeze({ rows: 1000, depth: 16, quantityPerParent: 1_000_000,
  effectiveQuantity: 2_147_483_647 });

function fail(code: string): never { throw new Error(code); }

export function normalizeCompositionDesignation(value: string): string {
  if (typeof value !== "string") fail("DESIGNATION_REQUIRED");
  const result = value.normalize("NFKC").trim().toUpperCase();
  if (!result) fail("DESIGNATION_REQUIRED");
  return result;
}

/** Counts are pieces per immediate parent; path products use BigInt before range conversion. */
export function validateCompositionTree(rows: readonly CompositionTreeRow[]): { effectiveQuantity: Map<string, number>; depth: Map<string, number> } {
  if (rows.length > COMPOSITION_LIMITS.rows) fail("COMPOSITION_ROWS_EXCEEDED");
  const byId = new Map<string, CompositionTreeRow>();
  const designations = new Set<string>();
  const lineages = new Set<string>();
  for (const row of rows) {
    if (!row.id || !row.revisionId || !row.lineageId || byId.has(row.id)) fail("COMPOSITION_ID_INVALID");
    if (!["MODULE", "PART", "HARDWARE"].includes(row.kind)) fail("COMPOSITION_KIND_INVALID");
    if (typeof row.title !== "string" || !row.title.trim()) fail("TITLE_REQUIRED");
    if (!Number.isSafeInteger(row.quantityPerParent) || row.quantityPerParent < 1 ||
      row.quantityPerParent > COMPOSITION_LIMITS.quantityPerParent) fail("QUANTITY_OUT_OF_RANGE");
    if (typeof row.travelsToInstallation !== "boolean") fail("INSTALLATION_MARK_INVALID");
    const designation = normalizeCompositionDesignation(row.designation);
    const uniqueDesignation = `${row.revisionId}\0${designation}`;
    const uniqueLineage = `${row.revisionId}\0${row.lineageId}`;
    if (designations.has(uniqueDesignation)) fail("DUPLICATE_DESIGNATION");
    if (lineages.has(uniqueLineage)) fail("DUPLICATE_LINEAGE");
    designations.add(uniqueDesignation);
    lineages.add(uniqueLineage);
    byId.set(row.id, row);
  }
  const effectiveQuantity = new Map<string, number>();
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  function visit(row: CompositionTreeRow): { quantity: bigint; level: number } {
    if (visiting.has(row.id)) fail("COMPOSITION_CYCLE");
    const saved = effectiveQuantity.get(row.id);
    if (saved !== undefined) return { quantity: BigInt(saved), level: depth.get(row.id)! };
    visiting.add(row.id);
    let quantity = BigInt(row.quantityPerParent);
    let level = 1;
    if (row.parentId !== null) {
      const parent = byId.get(row.parentId);
      if (!parent) fail("PARENT_NOT_FOUND");
      if (parent.revisionId !== row.revisionId) fail("PARENT_REVISION_MISMATCH");
      if (parent.kind !== "MODULE") fail("PARENT_NOT_MODULE");
      const context = visit(parent);
      quantity *= context.quantity;
      level = context.level + 1;
    }
    if (level > COMPOSITION_LIMITS.depth) fail("COMPOSITION_DEPTH_EXCEEDED");
    if (quantity > BigInt(COMPOSITION_LIMITS.effectiveQuantity)) fail("EFFECTIVE_QUANTITY_OVERFLOW");
    visiting.delete(row.id);
    effectiveQuantity.set(row.id, Number(quantity));
    depth.set(row.id, level);
    return { quantity, level };
  }
  for (const row of rows) visit(row);
  if (new Set(rows.map((row) => row.revisionId)).size > 1) fail("REVISION_MISMATCH");
  return { effectiveQuantity, depth };
}
