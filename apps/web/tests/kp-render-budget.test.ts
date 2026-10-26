import assert from "node:assert/strict";
import test from "node:test";
import { assertContractRenderBudget } from "../src/server/kp/api-render-budget";
import { KpApiError } from "../src/server/kp/api-contract";

const snapshots = { settings: {}, summary: {}, profile: {} };
const limits = { docxSources: 2, docxPngBytes: 12, docxTotalPngBytes: 40, stateBytes: 64 };
const limited = (run: () => unknown) => assert.throws(run, error => error instanceof KpApiError && error.status === 413);
test("DOCX budget counts all source appendices before encoding individual images", () => {
  const page = new Uint8Array(8);
  assertContractRenderBudget(limits, snapshots, [{ images: [page, page] }, { images: [page, page] }]);
  assertContractRenderBudget(limits, snapshots, [{ images: [page, page] }, { images: [page, page, page] }]);
  assertContractRenderBudget({ ...limits, docxTotalPngBytes: 65 * page.byteLength }, snapshots, [{ images: Array(65).fill(page) }]);
  limited(() => assertContractRenderBudget(limits, snapshots, [{ images: [page, page, page] }, { images: [page, page, page] }]));
  const image = new Uint8Array(12);
  limited(() => assertContractRenderBudget(limits, snapshots, [{ images: [image, image] }, { images: [image, image] }]));
});
test("oversized individual PNG or settings cannot reach private DOCX renderer", () => {
  limited(() => assertContractRenderBudget(limits, snapshots, [{ images: [new Uint8Array(13)] }]));
  limited(() => assertContractRenderBudget(limits, { ...snapshots, settings: { text: "x".repeat(64) } }, []));
  limited(() => assertContractRenderBudget(limits, snapshots, [{ images: [] }, { images: [] }, { images: [] }]));
});
