import assert from "node:assert/strict";
import { test } from "node:test";
import { isKpEnabled } from "../src/server/kp/config";
import {
  MAX_PROPOSAL_STATE_BYTES,
  ProposalStorageContractError,
  parseProposalObjectKey,
  parseProposalState,
  parseProposalStorageBinding,
} from "../src/server/kp/storage-contract";

function rejectsState(value: unknown, code = "KP_STATE_INVALID") {
  assert.throws(() => parseProposalState(value), error =>
    error instanceof ProposalStorageContractError && error.code === code);
}

test("состояние старого генератора сохраняет неизвестные поля и отделяется от исходного объекта", () => {
  const input = {
    items: [{ id: "old-1", name: "Шкаф", quantity: 2, price: "123.4500", blocks: [
      { name: "Каркас", custom: { options: [null, false, 0, "", { unknown: "ёж 🪑" }] } },
    ] }],
    future: { formatVersion: 13, note: "\"\\\n", ratio: 0.125, disabled: false },
  };
  const expected = structuredClone(input);
  const result = parseProposalState(input);
  assert.deepEqual(result, expected);
  assert.equal(JSON.stringify(result), JSON.stringify(expected));
  input.items[0].blocks[0].custom.options.push("изменение после проверки");
  input.future.note = "заменено";
  assert.deepEqual(result, expected);
  assert.notEqual(result.items[0], input.items[0]);
  assert.deepEqual(parseProposalState({ items: [] }), { items: [] });
});

test("повторно использованный объект не считается циклом и клонируется для каждого вхождения", () => {
  const shared = { dimensions: [100, 200, 300] };
  const result = parseProposalState({ items: [shared, shared] });
  assert.deepEqual(result.items, [shared, shared]);
  assert.notEqual(result.items[0], result.items[1]);
});

test("лимит полного снимка измеряется в байтах UTF-8 с учётом JSON-экранирования", () => {
  const overhead = Buffer.byteLength(JSON.stringify({ items: [], note: "" }), "utf8");
  const ascii = "a".repeat(MAX_PROPOSAL_STATE_BYTES - overhead);
  assert.equal(Buffer.byteLength(JSON.stringify(parseProposalState({ items: [], note: ascii }))), MAX_PROPOSAL_STATE_BYTES);
  rejectsState({ items: [], note: ascii + "b" }, "KP_STATE_TOO_LARGE");

  const unicode = "я".repeat(Math.floor((MAX_PROPOSAL_STATE_BYTES - overhead) / 2));
  assert.equal(parseProposalState({ items: [], note: unicode }).note, unicode);
  rejectsState({ items: [], note: unicode + "я" }, "KP_STATE_TOO_LARGE");
  rejectsState({ items: [], ["\n".repeat(300_000)]: "x" }, "KP_STATE_TOO_LARGE");
});

test("строки и ключи совместимы с PostgreSQL JSONB: без NUL и одиночных UTF-16 суррогатов", () => {
  for (const value of ["\u0000", "\ud800", "\udc00", "\ud800x", "x\udc00", "\udc00\ud800"]) {
    rejectsState({ items: [{ description: value }] });
    rejectsState({ items: [], [value]: "значение" });
  }
  const input = { items: [{ name: "Стул 🪑", "😀": "пара \ud83d\ude00" }] };
  assert.deepEqual(parseProposalState(input), input);
});

test("корень и позиции должны быть объектами с обязательным массивом items", () => {
  for (const value of [null, [], "{}", 1, {}, { items: null }, { items: {} },
    { items: [null] }, { items: [[]] }, { items: ["изделие"] }]) rejectsState(value);
});

test("не-JSON значения и значения, которые JSON.stringify молча меняет, отклоняются", () => {
  for (const value of [undefined, () => 1, Symbol("private"), BigInt(1), NaN, Infinity, -Infinity,
    new Date(), new Map(), new Set(), new Uint8Array([1]), /name/]) {
    rejectsState({ items: [{ unknown: { value } }] });
  }
  rejectsState({ items: [], custom: Object.create({ inherited: "hidden" }) });
  rejectsState({ items: [], custom: Object.assign([], { extra: "would be lost" }) });
  rejectsState({ items: [], custom: new Array(10) });
  rejectsState({ items: [], custom: [undefined] });
  rejectsState({ items: [], [Symbol("hidden")]: "would be lost" });
  const hidden = Object.defineProperty({ items: [] }, "hidden", { value: 42 });
  rejectsState(hidden);
});

test("опасные ключи отклоняются рекурсивно без выполнения геттеров и toJSON", () => {
  for (const key of ["__proto__", "prototype", "constructor"]) {
    const value: unknown = JSON.parse(`{"items":[{"nested":{"${key}":{"polluted":true}}}]}`);
    rejectsState(value);
  }
  let called = false;
  const accessor = Object.defineProperty({ items: [] }, "state", {
    enumerable: true,
    get() { called = true; return "не должно читаться"; },
  });
  rejectsState(accessor);
  rejectsState({ items: [], toJSON() { called = true; return { items: [] }; } });
  assert.equal(called, false);
  assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted"), false);
});

test("циклы, чрезмерная вложенность и широкий снимок останавливаются до сериализации", () => {
  const cyclic: Record<string, unknown> = { items: [] };
  cyclic.self = cyclic;
  rejectsState(cyclic);
  let deep: unknown = { leaf: "значение" };
  for (let i = 0; i < 80; i++) deep = { child: deep };
  rejectsState({ items: [], deep });
  rejectsState({ items: [], wide: Array.from({ length: 100_001 }, () => 0) });
  let reasonable: unknown = "значение";
  for (let i = 0; i < 20; i++) reasonable = { child: reasonable };
  assert.deepEqual(parseProposalState({ items: [], reasonable }).reasonable, reasonable);
});

test("раздел КП включается только точным значением 1", () => {
  for (const value of [undefined, "", "0", "true", "TRUE", "false", " 1", "1 ", "yes"]) {
    assert.equal(isKpEnabled({ PERO_KP_ENABLED: value }), false);
  }
  assert.equal(isKpEnabled({}), false);
  assert.equal(isKpEnabled({ PERO_KP_ENABLED: "1" }), true);
});

test("привязка хранилища содержит только адрес, бакет и необязательный регион без секретов", () => {
  for (const input of [
    { endpoint: "https://s3.example.invalid/", bucket: "crm-documents", region: "us-east-1" },
    { endpoint: "http://127.0.0.1:9000", bucket: "crm_files" },
    { endpoint: "HTTPS://s3.example.invalid/", bucket: "b".repeat(255), region: "r".repeat(255) },
  ]) {
    const result = parseProposalStorageBinding(input);
    assert.deepEqual(result, input);
    assert.notEqual(result, input);
  }
  for (const value of [null, {}, { endpoint: "https://s3.invalid", bucket: "" },
    { endpoint: "https://user:secret@s3.invalid", bucket: "crm" },
    { endpoint: "https://s3.invalid?accessKey=secret", bucket: "crm" },
    { endpoint: "https://s3.invalid#secret", bucket: "crm" },
    { endpoint: "https:s3.invalid", bucket: "crm" },
    { endpoint: "file:///tmp/storage", bucket: "crm" },
    { endpoint: "https://s3.invalid", bucket: "crm", accessKey: "secret" },
    { endpoint: "https://s3.invalid", bucket: "crm", region: "" },
    { endpoint: "https://s3.invalid", bucket: "b".repeat(256) },
    { endpoint: "https://s3.invalid", bucket: "crm", region: "r".repeat(256) },
    { endpoint: "https://s3.invalid", bucket: "crm files" },
  ]) {
    assert.throws(() => parseProposalStorageBinding(value), error =>
      error instanceof ProposalStorageContractError && error.code === "KP_STORAGE_BINDING_INVALID" && !error.message.includes("secret"));
  }
});

test("ключ файла остаётся внутри kp и не допускает неоднозначные пути", () => {
  for (const key of ["kp/a", "kp/proposal-1/images/image.jpg", "kp/contracts/2026/file.docx", "kp/" + "a".repeat(1021)]) {
    assert.equal(parseProposalObjectKey(key), key);
  }
  for (const value of [undefined, "", "kp/", "/kp/file.pdf", "project/file.pdf", "https://s3.invalid/kp/file",
    "kp/../file", "kp/a/./file", "kp/a//file", "kp/a\\file", "kp/%2e%2e/file", "kp/a%2fb",
    "kp/a?download=1", "kp/file#fragment", "kp/a\u0000file", "kp/снимок.pdf", "kp/-a", "kp/_a", "kp/.hidden",
    "kp/a/", "kp/" + "a".repeat(1022)]) {
    assert.throws(() => parseProposalObjectKey(value), error =>
      error instanceof ProposalStorageContractError && error.code === "KP_OBJECT_KEY_INVALID");
  }
});
