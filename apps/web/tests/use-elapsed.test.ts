import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { elapsedTextFor, formatElapsed, useElapsed } from "../src/lib/use-elapsed";

function Timer({ startedAt }: { startedAt: string | null }) {
  return createElement("span", null, useElapsed(startedAt));
}

test("active timer server markup is stable across different render times", () => {
  const originalNow = Date.now;
  try {
    Date.now = () => Date.parse("2026-09-29T12:00:00.000Z");
    const first = renderToString(createElement(Timer, { startedAt: "2026-09-29T11:59:00.000Z" }));
    Date.now = () => Date.parse("2026-09-29T12:00:01.000Z");
    const second = renderToString(createElement(Timer, { startedAt: "2026-09-29T11:59:00.000Z" }));

    assert.equal(second, first);
    assert.equal(first, "<span>—</span>");
  } finally {
    Date.now = originalNow;
  }
});

test("elapsed formatting keeps minute and hour boundaries", () => {
  const startedAt = "2026-09-29T11:00:00.000Z";
  const start = Date.parse(startedAt);
  assert.equal(formatElapsed(startedAt, start + 59_000), "00:59");
  assert.equal(formatElapsed(startedAt, start + 60_000), "01:00");
  assert.equal(formatElapsed(startedAt, start + 3_661_000), "1:01:01");
  assert.equal(formatElapsed(startedAt, start - 1), "00:00");
});

test("changing active timer never displays the previous timer snapshot", () => {
  const oldStartedAt = "2026-09-29T10:00:00.000Z";
  const newStartedAt = "2026-09-29T11:00:00.000Z";
  assert.equal(elapsedTextFor(newStartedAt, {
    startedAt: oldStartedAt,
    now: Date.parse("2026-09-29T12:00:00.000Z"),
  }), "—");
  assert.equal(elapsedTextFor(null, { startedAt: oldStartedAt, now: Date.now() }), "");
});
