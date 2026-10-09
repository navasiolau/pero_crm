import assert from "node:assert/strict";
import test from "node:test";
import {createUploadAttempt,sendFileUpload,sendUploadBatch,uploadTimeoutMsForSize,MULTI_UPLOAD_MAX_FILES,MULTI_UPLOAD_CONCURRENCY,MULTI_UPLOAD_LARGE_THRESHOLD_BYTES,type BatchUploadItem} from "../src/lib/file-upload-client";
import {DOCUMENT_UPLOAD_MAX_BYTES,IMAGE_UPLOAD_MAX_BYTES,resolveUploadSizeKind,uploadSizeLimitError,uploadSizeLimitFor} from "../src/server/files/upload-limits";

const MB = 1024 * 1024;
function file(name: string, type = "image/png") {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}
function item(name: string, size: number): BatchUploadItem {
  const form = new FormData();
  form.append("file", file(name));
  form.append("projectId", "project");
  form.append("section", "GENERAL");
  return { fileName: name, size, attempt: createUploadAttempt(form) };
}
function okFetcher(delayMs = 0): typeof fetch {
  return (async (_url, init) => {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const form = init!.body as FormData;
    return new Response(JSON.stringify({ ok: true, id: `id-${form.get("clientMutationId")}`, clientMutationId: form.get("clientMutationId") }), { status: 200 });
  }) as typeof fetch;
}

test("лимиты: изображения и обложки 25 МБ, документы до 1 ГБ, раздельные тексты", () => {
  assert.equal(IMAGE_UPLOAD_MAX_BYTES, 25 * MB);
  assert.equal(DOCUMENT_UPLOAD_MAX_BYTES, 1024 * MB);
  assert.deepEqual(uploadSizeLimitFor({ mimeType: "image/jpeg" }), { maxBytes: 25 * MB, kind: "image" });
  assert.deepEqual(uploadSizeLimitFor({ mimeType: "application/pdf" }), { maxBytes: 1024 * MB, kind: "document" });
  assert.deepEqual(uploadSizeLimitFor({ mimeType: "" }), { maxBytes: 1024 * MB, kind: "document" });
  // Обложки остаются под лимитом изображений даже при пустом MIME.
  assert.equal(resolveUploadSizeKind({ mimeType: "", assignCover: true }), "image");
  assert.equal(resolveUploadSizeKind({ mimeType: "", assignProjectCover: true }), "image");
  assert.equal(uploadSizeLimitError("image"), "Файл больше 25 МБ");
  assert.equal(uploadSizeLimitError("document"), "Файл больше 1 ГБ");
});

test("таймаут зависит от размера: 60с до 25 МБ, до 10 мин к 1 ГБ", () => {
  assert.equal(uploadTimeoutMsForSize(0), 60_000);
  assert.equal(uploadTimeoutMsForSize(25 * MB), 60_000);
  assert.equal(uploadTimeoutMsForSize(1024 * MB), 600_000);
  assert.equal(uploadTimeoutMsForSize(2 * 1024 * MB), 600_000);
  const mid = uploadTimeoutMsForSize(512 * MB);
  assert.ok(mid > 60_000 && mid < 600_000, `середина шкалы внутри (60с, 10мин), получено ${mid}`);
  assert.ok(uploadTimeoutMsForSize(900 * MB) > mid, "таймаут растёт с размером");
});

test("таймаут по умолчанию выводится из размера файла, явный приоритетнее", async () => {
  // Мелкий файл с медленным ответом в пределах 60с — успех без явного timeoutMs.
  const slow = okFetcher(50);
  const result = await sendFileUpload(item("photo.png", 3 * MB).attempt, { fetcher: slow });
  assert.equal(result.ok, true);
  // Явный короткий таймаут по-прежнему прерывает.
  const timed = await sendFileUpload(item("photo.png", 3 * MB).attempt, { fetcher: okFetcher(100), timeoutMs: 5 });
  assert.equal(timed.ok, false);
  if (!timed.ok) assert.equal(timed.failure.code, "UPLOAD_TIMEOUT");
});

test("пачка режется на 100 файлов с подсчётом усечения", async () => {
  const items = Array.from({ length: MULTI_UPLOAD_MAX_FILES + 5 }, (_, index) => item(`f${index}.png`, MB));
  const summary = await sendUploadBatch(items, { fetcher: okFetcher() });
  assert.equal(summary.results.length, MULTI_UPLOAD_MAX_FILES);
  assert.equal(summary.truncated, 5);
  assert.ok(summary.results.every((entry) => entry.result.ok));
});

test("каждый файл пачки — свой clientMutationId, порядок результатов как в выборе", async () => {
  const items = [item("a.png", MB), item("b.png", MB), item("c.png", MB), item("d.png", 2 * MB)];
  const ids = new Set(items.map((entry) => entry.attempt.clientMutationId));
  assert.equal(ids.size, items.length);
  // Обратные задержки: результаты всё равно в порядке выбора.
  let call = 0;
  const fetcher = (async (_url: unknown, init: unknown) => {
    const delay = [60, 40, 20, 0][call++];
    await new Promise((resolve) => setTimeout(resolve, delay));
    const form = (init as { body: FormData }).body;
    return new Response(JSON.stringify({ ok: true, id: `id-${form.get("clientMutationId")}`, clientMutationId: form.get("clientMutationId") }), { status: 200 });
  }) as typeof fetch;
  const summary = await sendUploadBatch(items, { fetcher });
  assert.deepEqual(summary.results.map((entry) => entry.fileName), ["a.png", "b.png", "c.png", "d.png"]);
});

test("ошибка одного файла не валит пачку", async () => {
  const items = [item("good1.png", MB), item("bad.png", MB), item("good2.png", MB)];
  const fetcher = (async (_url: unknown, init: unknown) => {
    const form = (init as { body: FormData }).body;
    const attached = ((form.get("file") as File).name);
    if (attached === "bad.png") {
      return new Response(JSON.stringify({ ok: false, error: "Файл больше 25 МБ", code: "UPLOAD_TOO_LARGE", requestId: "r1", details: { phase: "validation", message: "Лимит" }, commitState: "notCommitted" }), { status: 413 });
    }
    return new Response(JSON.stringify({ ok: true, id: attached, clientMutationId: form.get("clientMutationId") }), { status: 200 });
  }) as typeof fetch;
  const summary = await sendUploadBatch(items, { fetcher });
  assert.equal(summary.results[0].result.ok, true);
  assert.equal(summary.results[1].result.ok, false);
  assert.equal(summary.results[2].result.ok, true);
  if (!summary.results[1].result.ok) assert.match(summary.results[1].result.failure.error, /25 МБ/);
});

test("мелкие файлы идут пулом до 4, крупные — строго последовательно", async () => {
  let active = 0, maxActive = 0;
  const tracking = (delayMs: number): typeof fetch => (async () => {
    active++; maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    active--;
    return new Response(JSON.stringify({ ok: true, id: "x", clientMutationId: "y" }), { status: 200 });
  }) as typeof fetch;
  // Пул для мелких: параллельность есть, но не выше лимита.
  const small = Array.from({ length: 8 }, (_, index) => item(`s${index}.png`, MB));
  await sendUploadBatch(small, { fetcher: tracking(20) });
  assert.ok(maxActive >= 2 && maxActive <= MULTI_UPLOAD_CONCURRENCY, `пул 2..4, было ${maxActive}`);
  // Крупные (>25 МБ): строго по одному.
  active = 0; maxActive = 0;
  const large = [item("l1.pdf", 30 * MB), item("l2.pdf", 40 * MB), item("l3.pdf", 50 * MB)];
  await sendUploadBatch(large, { fetcher: tracking(20) });
  assert.equal(maxActive, 1);
  assert.ok(MULTI_UPLOAD_LARGE_THRESHOLD_BYTES === 25 * MB);
});

test("таймаут пачки считается от размера каждого файла", async () => {
  const seen: number[] = [];
  const pendingForever = ((_url: unknown, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(Object.assign(Error("aborted"), { name: "AbortError" })));
  })) as unknown as typeof fetch;
  const summary = await sendUploadBatch([item("small.png", MB), item("big.pdf", 600 * MB)], {
    fetcher: pendingForever,
    timeoutForSize: (size) => { seen.push(size); return 20; },
  });
  assert.deepEqual(seen, [MB, 600 * MB]);
  assert.ok(summary.results.every((entry) => !entry.result.ok));
  if (!summary.results[0].result.ok) assert.equal(summary.results[0].result.failure.code, "UPLOAD_TIMEOUT");
});
