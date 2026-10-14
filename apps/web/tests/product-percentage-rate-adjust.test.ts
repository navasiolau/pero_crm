import assert from "node:assert/strict";
import test from "node:test";
import { createRequire, Module } from "node:module";
import * as React from "react";

const customRequire = createRequire(import.meta.url);
function inject(name: string, exp: Record<string, unknown>) {
  const file = customRequire.resolve(name);
  const stub = new Module(file);
  (stub as unknown as { filename: string }).filename = file;
  (stub as unknown as { loaded: boolean }).loaded = true;
  stub.exports = exp;
  (customRequire.cache as unknown as Record<string, Module>)[file] = stub;
}
inject("next/navigation", { redirect() { throw Error("DENIED"); }, useRouter: () => ({ refresh() {} }) });
inject("../src/components/product-inline-provider", { useOptionalProductInline: () => null });
inject("../src/lib/independent-product-percentage-action", { invokeProductPercentagePatch() { throw Error("WRITE"); } });
inject("../src/server/product-percentage-pay/actions", { retryProductPercentageAction() { throw Error("WRITE"); } });
(globalThis as unknown as { React: typeof React }).React = React;
const { previewRateFromDraft } = customRequire("../src/app/(app)/products/[id]/product-percentage-panel") as typeof import("../src/app/(app)/products/[id]/product-percentage-panel");
test("превью-ставка берётся из черновика, иначе из сохранённой", () => {
  assert.equal(previewRateFromDraft("6", "5"), "6.00");
  assert.equal(previewRateFromDraft("1.25", "5"), "1.25");
  assert.equal(previewRateFromDraft("", "5"), "5");
  assert.equal(previewRateFromDraft(".", "5"), "5");
  assert.equal(previewRateFromDraft("", null), null);
});
