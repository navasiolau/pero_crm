import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequestId } from "../src/lib/request-id";

test("request id falls back to cryptographic random bytes when randomUUID is unavailable", () => {
  const random = { randomUUID: undefined, getRandomValues: (bytes: Uint8Array) => { bytes.set(Array.from({ length: 16 }, (_, i) => i)); return bytes; } };
  assert.match(createRequestId(random), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
