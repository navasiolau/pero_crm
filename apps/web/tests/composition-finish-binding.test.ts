import assert from "node:assert/strict";
import { test } from "node:test";

import { bindFinishDraftMutation, captureFinishDraftBinding, finishMutationDisposition } from "../src/components/composition-finish-binding";

test("finish mutation remains bound to the draft revision/version opened before refreshed props", () => {
  const binding = captureFinishDraftBinding("product-1", {
    id: "draft-1", status: "DRAFT", draftVersion: 7,
  });
  assert.ok(binding);

  const refreshedSelected = { id: "draft-1", status: "DRAFT", draftVersion: 8 };
  const actionInput = bindFinishDraftMutation(binding, {
    itemId: "part-1", surfaceKind: "FACE", surfaceLabel: "Лицевая", layerOrder: 1,
  });
  assert.equal(refreshedSelected.draftVersion, 8);
  assert.deepEqual(actionInput, {
    productId: "product-1", revisionId: "draft-1", expectedDraftVersion: 7,
    itemId: "part-1", surfaceKind: "FACE", surfaceLabel: "Лицевая", layerOrder: 1,
  });
});

test("finish editor cannot bind to a confirmed revision", () => {
  assert.equal(captureFinishDraftBinding("product-1", {
    id: "revision-1", status: "CONFIRMED", draftVersion: 9,
  }), null);
});

test("payload cannot overwrite the captured product, revision or version", () => {
  const binding = { productId: "product-1", revisionId: "draft-1", expectedDraftVersion: 7 };
  const result = bindFinishDraftMutation(binding, { productId: "refreshed-product", revisionId: "draft-2", expectedDraftVersion: 8, finishId: "finish-1" });
  assert.deepEqual(result, { ...binding, finishId: "finish-1" });
});

test("unknown finish mutation result closes the old editor and refreshes instead of retrying", () => {
  assert.deepEqual(finishMutationDisposition("unknown"), {
    closeEditor: true,
    refresh: true,
    message: "Результат сохранения неизвестен. Проверьте карточку перед новой правкой.",
  });
  const deletion = finishMutationDisposition("unknown", "delete");
  assert.equal(deletion.closeEditor, true);
  assert.match(deletion.message, /результат удаления неизвестен/i);
});
