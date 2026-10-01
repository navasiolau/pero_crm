import assert from "node:assert/strict";
import test from "node:test";
import { formatDateTime } from "../src/lib/format";

test("SSR UTC and browser Moscow render the same business timestamp", () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = "UTC";
    const server = formatDateTime("2026-10-01T10:00:00.000Z");
    process.env.TZ = "Europe/Moscow";
    const browser = formatDateTime("2026-10-01T10:00:00.000Z");
    assert.equal(server, browser);
    assert.match(server, /13:00:00/);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
