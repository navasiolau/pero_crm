import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeCompositionDesignation, validateCompositionTree } from "../src/lib/composition-tree";

type Row = Parameters<typeof validateCompositionTree>[0][number];
const item = (id: string, kind: Row["kind"], quantityPerParent: number, parentId: string | null = null,
  rest: Partial<Row> = {}): Row => ({ id, revisionId: "revision", lineageId: id, parentId, kind,
    designation: id, title: id, quantityPerParent, travelsToInstallation: false, ...rest });

test("quantities multiply on a path, while stored child quantity stays relative", () => {
  const rows = [item("module", "MODULE", 2), item("part", "PART", 3, "module"), item("hardware", "HARDWARE", 4, "module")];
  const result = validateCompositionTree(rows);
  assert.equal(result.effectiveQuantity.get("module"), 2);
  assert.equal(result.effectiveQuantity.get("part"), 6);
  assert.equal(result.effectiveQuantity.get("hardware"), 8);
  assert.equal(rows[1].quantityPerParent, 3);
});

test("NFKC trim uppercase designation is unique in a revision", () => {
  assert.equal(normalizeCompositionDesignation("  ａ-１  "), "A-1");
  assert.throws(() => validateCompositionTree([item("a", "PART", 1, null, { designation: "ａ-１" }),
    item("b", "PART", 1, null, { designation: "A-1" })]), /DUPLICATE_DESIGNATION/);
});

test("cross-revision parent, non-module parent and cycle fail closed", () => {
  assert.throws(() => validateCompositionTree([item("parent", "PART", 1), item("child", "PART", 1, "parent")]), /PARENT_NOT_MODULE/);
  assert.throws(() => validateCompositionTree([item("parent", "MODULE", 1),
    item("child", "PART", 1, "parent", { revisionId: "other" })]), /PARENT_REVISION_MISMATCH/);
  assert.throws(() => validateCompositionTree([item("a", "MODULE", 1, "b"), item("b", "MODULE", 1, "a")]), /COMPOSITION_CYCLE/);
});

test("fixed row, depth, local quantity and effective quantity bounds", () => {
  assert.throws(() => validateCompositionTree([item("zero", "PART", 0)]), /QUANTITY_OUT_OF_RANGE/);
  assert.throws(() => validateCompositionTree([item("large", "PART", 1_000_001)]), /QUANTITY_OUT_OF_RANGE/);
  const overflowing = [item("a", "MODULE", 1_000_000), item("b", "MODULE", 1_000_000, "a"),
    item("c", "PART", 3, "b")];
  assert.throws(() => validateCompositionTree(overflowing), /EFFECTIVE_QUANTITY_OVERFLOW/);
  const deep: Row[] = [item("root", "MODULE", 1)];
  for (let index = 1; index <= 16; index++) deep.push(item(`depth-${index}`, "MODULE", 1, deep[index - 1].id));
  assert.throws(() => validateCompositionTree(deep), /COMPOSITION_DEPTH_EXCEEDED/);
  const many = Array.from({ length: 1001 }, (_, index) => item(`row-${index}`, "PART", 1));
  assert.throws(() => validateCompositionTree(many), /COMPOSITION_ROWS_EXCEEDED/);
});

test("module and child may both be marked for installation without creating shipping counts", () => {
  const rows = [item("module", "MODULE", 2, null, { travelsToInstallation: true }),
    item("part", "PART", 3, "module", { travelsToInstallation: true })];
  const result = validateCompositionTree(rows);
  assert.equal(result.effectiveQuantity.get("part"), 6);
  assert.equal(result.effectiveQuantity.size, 2);
});

test("standalone module remains a real item without invented children", () => {
  const result = validateCompositionTree([item("whole-module", "MODULE", 2)]);
  assert.deepEqual([...result.effectiveQuantity], [["whole-module", 2]]);
});

test("one tree cannot silently mix independent rows from different revisions", () => {
  assert.throws(() => validateCompositionTree([item("one", "PART", 1),
    item("two", "PART", 1, null, { revisionId: "another" })]), /REVISION_MISMATCH/);
});
