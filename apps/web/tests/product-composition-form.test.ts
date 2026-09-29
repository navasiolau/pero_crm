import assert from "node:assert/strict";
import { test } from "node:test";
import { compositionParentOptions, nextCompositionConfirmRequestId, parseCompositionQuantity } from "../src/components/composition-form";

test("parent choices include only modules outside the edited subtree", () => {
  const rows = [
    { id: "root", kind: "MODULE", parentId: null },
    { id: "nested", kind: "MODULE", parentId: "root" },
    { id: "part", kind: "PART", parentId: "nested" },
    { id: "sibling", kind: "MODULE", parentId: null },
  ];
  assert.deepEqual(compositionParentOptions(rows, "root").map((row) => row.id), ["sibling"]);
  assert.deepEqual(compositionParentOptions(rows, "part").map((row) => row.id), ["root", "nested", "sibling"]);
});

test("form accepts only exact positive integer counts within the composition limit", () => {
  assert.equal(parseCompositionQuantity("1"), 1);
  assert.equal(parseCompositionQuantity("1000000"), 1_000_000);
  for (const value of ["", "0", "1.5", "1e3", "1000001", "-1"]) assert.equal(parseCompositionQuantity(value), null);
});

test("uncertain confirmation retries reuse exactly the original UUID", () => {
  let generated = 0;
  const create = () => `request-${++generated}`;
  const first = nextCompositionConfirmRequestId(null, create);
  assert.equal(nextCompositionConfirmRequestId(first, create), first);
  assert.equal(generated, 1);
  assert.notEqual(nextCompositionConfirmRequestId(null, create), first);
});
