import assert from "node:assert/strict";
import { test } from "node:test";
import { compositionErrorMessage } from "../src/server/composition/errors";

test("server error codes have safe Russian messages for stale forms and tree validation", () => {
  assert.match(compositionErrorMessage("DRAFT_VERSION_CHANGED"), /Обновите карточку/);
  assert.match(compositionErrorMessage("COMPOSITION_CYCLE"), /потомка/);
  assert.doesNotMatch(compositionErrorMessage("unknown Prisma raw error"), /Prisma|raw/i);
});
