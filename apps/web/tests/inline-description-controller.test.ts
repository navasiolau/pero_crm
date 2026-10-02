import assert from "node:assert/strict";
import test from "node:test";
import { createInlineSaveController, type InlineOptions, type InlineRequest } from "../src/lib/inline-save-controller";
import { normalizeProductDescription } from "../src/lib/product-description";
import { isUnchangedProductDescriptionDraft } from "../src/lib/product-description-draft";

function description(initialValue: string | null) {
  const requests: InlineRequest<string | null>[] = [];
  const options: InlineOptions<string | null> = {
    initialValue, format: value => value ?? "", parse: normalizeProductDescription,
    isUnchangedDraft: isUnchangedProductDescriptionDraft,
    id: () => "test-description-id",
    save: async request => { requests.push(request); return { kind: "saved", value: request.value }; },
  };
  return { controller: createInlineSaveController(options), requests };
}

test("untouched legacy whitespace description blur and flush do not canonicalize storage", async () => {
  const s = description(" \t\r\n ");
  assert.equal(await s.controller.commit(), true);
  assert.equal(await s.controller.flush(), true);
  assert.equal(s.requests.length, 0);
  assert.equal(s.controller.getSnapshot().baseline, " \t\r\n ");
});

test("DOM newline representation alone does not rewrite raw CRLF baseline", async () => {
  const s = description(" \t\r\n ");
  s.controller.setDraft(" \t\n ");
  assert.equal(await s.controller.commit(), true);
  assert.equal(s.requests.length, 0);
  assert.equal(s.controller.getSnapshot().baseline, " \t\r\n ");
});

test("edited description preserves literal text and exact expectedValue; actual whitespace edit clears", async () => {
  const raw = "  old\r\n\tline  ";
  const s = description(raw);
  const edited = "  <b>literal</b>\n\n\tline  ";
  s.controller.setDraft(edited);
  await s.controller.commit();
  assert.equal(s.requests[0].expectedValue, raw);
  assert.equal(s.requests[0].value, edited);
  s.controller.setDraft("  \t\n");
  await s.controller.commit();
  assert.equal(s.requests[1].expectedValue, edited);
  assert.equal(s.requests[1].value, null);
});

test("genuine clear of legacy whitespace saves null instead of treating trim equality as no-op", async () => {
  const s = description(" \t\r\n ");
  s.controller.setDraft("");
  await s.controller.commit();
  assert.deepEqual(s.requests, [{value: null, expectedValue: " \t\r\n ", clientMutationId: "test-description-id"}]);
});

test("CRLF edited value remains exact and lost ACK retries same raw request", async () => {
  const requests: InlineRequest<string | null>[] = [];
  let fail = true;
  const c = createInlineSaveController<string | null>({
    initialValue: "old\r\n", format: value => value ?? "", parse: normalizeProductDescription,
    isUnchangedDraft: isUnchangedProductDescriptionDraft,
    id: () => "lost-description-id",
    save: async request => { requests.push(request); if (fail) throw Error("lost ACK"); return {kind: "saved", value: request.value}; },
  });
  const edited = "  new\r\n\r\n\tend  ";
  c.setDraft(edited);
  assert.equal(await c.commit(), false);
  fail = false;
  assert.equal(await c.retry(), true);
  assert.deepEqual(requests[1], requests[0]);
  assert.equal(requests[0].value, edited);
  assert.equal(requests[0].expectedValue, "old\r\n");
  assert.equal(c.getSnapshot().draft, edited);
});
