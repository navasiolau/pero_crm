import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { createFinanceDocumentQueue, FinanceUploadFailure, type FinanceUploadRow } from "../src/components/finance-document-queue";

test("three files keep separate progress/UUID and retry only UNKNOWN while READY rows remain", async () => {
  let rows: FinanceUploadRow[] = [], serial = 0, secondFailed = false, active = 0, maxActive = 0;
  const calls: {file: File; id: string}[] = [];
  const queue = createFinanceDocumentQueue(async (row, progress) => {
    active++; maxActive = Math.max(maxActive, active); calls.push({file: row.file, id: row.clientMutationId});
    try {
      progress(50); await setImmediate();
      if (row.file.name === "2.pdf" && !secondFailed) { secondFailed = true; throw new FinanceUploadFailure("ACK lost", true); }
      return {id: row.clientMutationId, fileName: row.file.name, mimeType: row.file.type, source: "finance", size: row.file.size, paymentId: null, createdAt: "2026-10-22T00:00:00Z"};
    } finally { active--; }
  }, next => { rows = next; }, () => `uuid-${++serial}`);
  const files = [1,2,3].map(index => new File(["%PDF"], `${index}.pdf`, {type: "application/pdf"}));
  queue.add(files);
  for (let count = 0; count < 30 && rows.some(row => ["QUEUED", "UPLOADING"].includes(row.state)); count++) await setImmediate();
  assert.equal(maxActive, 1); assert.deepEqual(rows.map(row => row.state), ["READY", "UNKNOWN", "READY"]);
  assert.equal(rows.some(row => row.state !== "READY"), true);
  queue.retry(rows[1].clientMutationId);
  for (let count = 0; count < 30 && rows.some(row => ["QUEUED", "UPLOADING"].includes(row.state)); count++) await setImmediate();
  assert.deepEqual(rows.map(row => row.state), ["READY", "READY", "READY"]);
  assert.equal(calls.length, 4); assert.deepEqual(calls[1], calls[3]); assert.equal(calls[1].file, files[1]);
  assert.deepEqual(rows.map(row => row.document?.fileName), ["1.pdf", "2.pdf", "3.pdf"]);
  queue.exclude(rows[1].clientMutationId); assert.deepEqual(rows.map(row => row.document?.fileName), ["1.pdf", "3.pdf"]);
});

test("empty file is an isolated error; exclusion releases the draft without a storage request", async () => {
  let rows: FinanceUploadRow[] = [], writes = 0;
  const queue = createFinanceDocumentQueue(async () => { writes++; throw Error("UNEXPECTED_UPLOAD"); }, next => { rows = next; });
  queue.add([new File([], "Пустой.pdf")]); assert.equal(rows[0].state, "ERROR"); assert.equal(writes, 0);
  queue.retry(rows[0].clientMutationId); assert.equal(writes, 0);
  queue.exclude(rows[0].clientMutationId); assert.deepEqual(rows, []);
});
