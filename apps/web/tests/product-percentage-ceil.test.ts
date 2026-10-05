import assert from "node:assert/strict";
import { test } from "node:test";
import { singleProductPercentagePreview } from "../src/lib/single-product-percentage-ui";

const draft = { state: "DRAFT", version: 4, unitPrice: "999.30", quantity: 1, rate: "100", frozenTotal: null, recipientEligible: true } as const;
for (const kind of ["ENGINEERING", "ASSEMBLY", "INSTALLATION"] as const) {
  test(`${kind}: v4 ceiling uses the exact result, including sub-cent values`, () => {
    const preview = (unitPrice: string, rate: string) => singleProductPercentagePreview({ ...draft, kind, unitPrice, rate });
    assert.equal(preview("999.30", "100"), "1000.00");
    assert.equal(preview("1000", "5"), "50.00");
    assert.equal(preview("0.01", "1"), "1.00");
    assert.equal(preview("0", "5"), "0.00");
    assert.equal(preview("999.30", "0"), "0.00");
  });
  test(`${kind}: v4 keeps unit engineering and batch assembly/installation`, () => {
    assert.equal(singleProductPercentagePreview({ ...draft, kind, unitPrice: "1000", quantity: 3, rate: kind === "ENGINEERING" ? "5" : kind === "ASSEMBLY" ? "4" : "7" }),
      kind === "ENGINEERING" ? "50.00" : kind === "ASSEMBLY" ? "120.00" : "210.00");
  });
}
test("v4: NULL, invalid input and rounded overflow stay unavailable; zero is explicit", () => {
  const row = { ...draft, kind: "ENGINEERING" as const };
  assert.equal(singleProductPercentagePreview({ ...row, unitPrice: null }), null);
  assert.equal(singleProductPercentagePreview({ ...row, rate: null }), null);
  assert.equal(singleProductPercentagePreview({ ...row, quantity: null }), null);
  assert.equal(singleProductPercentagePreview({ ...row, rate: "101" }), null);
  assert.equal(singleProductPercentagePreview({ ...row, unitPrice: "9999999999.01" }), null);
  assert.equal(singleProductPercentagePreview({ ...row, unitPrice: "9999999999.00" }), "9999999999.00");
  assert.equal(singleProductPercentagePreview({ ...row, unitPrice: null, rate: "0" }), "0.00");
});
test("existing versions and frozen v4 totals are never repriced", () => {
  for (const version of [1, 2, 3] as const) {
    const row = { ...draft, version, kind: "ENGINEERING" as const };
    assert.equal(singleProductPercentagePreview(row), "999.30");
    assert.equal(singleProductPercentagePreview({ ...row, state: "SETTLED", frozenTotal: "999.30", unitPrice: "1" }), "999.30");
  }
  assert.equal(singleProductPercentagePreview({ ...draft, kind: "ENGINEERING", state: "SETTLED", frozenTotal: "1000.00", unitPrice: "1" }), "1000.00");
});
