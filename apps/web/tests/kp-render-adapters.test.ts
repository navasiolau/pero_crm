import assert from "node:assert/strict";
import test from "node:test";
import { contractArtifact, lifecycleMediaIds, proposalRenderAssets } from "../src/server/kp/api-render-adapters";
import { KpApiError } from "../src/server/kp/api-contract";
import type { ArtifactRecord, LifecycleState } from "../src/server/kp/lifecycle-contract";

const unavailable = (code: string) => (error: unknown) => error instanceof KpApiError && error.status === 410 && error.code === code;

test("lifecycle media projection requires stable IDs and preserves saved state and both slots", () => {
  const first = "11111111-1111-4111-8111-111111111111", second = "22222222-2222-4222-8222-222222222222";
  const state: LifecycleState = { extra: { untouched: true }, items: [
    { id: "item-a", price: "100.75", image: "kp-media:" + first, image2: "kp-media:" + second },
    { id: "item-b", image: "kp-media:" + first },
  ] };
  const before = structuredClone(state);
  assert.deepEqual(lifecycleMediaIds(state), [first, second]);
  assert.deepEqual(state, before);
  const invalidItems: LifecycleState["items"] = [{}, { id: null }, { id: 0 }, { id: "" }, { id: " " }];
  for (const item of invalidItems) {
    assert.throws(() => lifecycleMediaIds({ items: [item] }), unavailable("KP_RENDER_SOURCE_INVALID"));
  }
});

test("contract artifact adapter admits only the preserved PDF/DOCX kind without coercing other formats", () => {
  const artifact: ArtifactRecord = { id: "artifact", proposalId: "proposal", contractId: null, kind: "PDF", state: "PENDING",
    storageBinding: { endpoint: "https://storage.example.invalid", bucket: "private" }, key: "kp/proposals/proposal/exports/native.pdf",
    sha256: "a".repeat(64), size: 5, fileName: "КП.pdf", mimeType: "application/pdf" };
  const before = structuredClone(artifact);
  assert.deepEqual(contractArtifact(artifact), artifact);
  const docx = { ...artifact, kind: "DOCX", proposalId: null, contractId: "contract" };
  assert.deepEqual(contractArtifact(docx), docx);
  for (const kind of ["IMAGE", "pdf", "", "CSV"]) assert.throws(() => contractArtifact({ ...artifact, kind }), unavailable("KP_ARTIFACT_INVALID"));
  assert.deepEqual(artifact, before);
});

test("renderer assets preserve exact allowed MIME and bytes and reject every unsupported representation", () => {
  const assets = ["image/jpeg", "image/png", "image/webp"].map((mimeType, index) => ({ mediaId: "media-" + index, mimeType, bytesBase64: "AQIDBA==" }));
  const before = structuredClone(assets);
  assert.deepEqual(proposalRenderAssets(assets), assets);
  assert.deepEqual(assets, before);
  for (const mimeType of ["image/svg+xml", "text/html", "IMAGE/PNG", "image/png; charset=utf-8", "image/gif", "image/avif", ""]) {
    assert.throws(() => proposalRenderAssets([{ ...assets[0], mimeType }]), unavailable("KP_RENDER_ASSET_INVALID"));
  }
});
