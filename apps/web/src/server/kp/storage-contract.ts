import { Buffer } from "node:buffer";

export type ProposalJsonValue = string | number | boolean | null | ProposalJsonObject | ProposalJsonValue[];
export type ProposalJsonObject = { [key: string]: ProposalJsonValue };
export type ProposalState = ProposalJsonObject & { items: ProposalJsonObject[] };
export type ProposalStorageBinding = { endpoint: string; bucket: string; region?: string };

export const MAX_PROPOSAL_STATE_BYTES = 512 * 1024;
export const MAX_PROPOSAL_STATE_DEPTH = 64;
export const MAX_PROPOSAL_STATE_NODES = 100_000;

const messages = {
  KP_STATE_INVALID: "Некорректное состояние КП: нужен JSON-объект с массивом объектов items.",
  KP_STATE_TOO_LARGE: "Полное состояние КП превышает 512 КиБ.",
  KP_STORAGE_BINDING_INVALID: "Некорректная привязка приватного хранилища КП.",
  KP_OBJECT_KEY_INVALID: "Некорректный ключ файла в пространстве kp/.",
} as const;

export class ProposalStorageContractError extends Error {
  constructor(readonly code: keyof typeof messages) {
    super(messages[code]);
    this.name = "ProposalStorageContractError";
  }
}

const dangerousKeys = new Set(["__proto__", "prototype", "constructor"]);

function invalidState(): never {
  throw new ProposalStorageContractError("KP_STATE_INVALID");
}

function isObject(value: ProposalJsonValue): value is ProposalJsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateJsonbString(value: string): void {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 0 || code >= 0xdc00 && code <= 0xdfff) invalidState();
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) invalidState();
    }
  }
}

/** Клонируем значения без вызова геттеров/toJSON и считаем размер будущего JSON по мере обхода. */
function cloneJson(input: unknown): ProposalJsonValue {
  const ancestors = new WeakSet<object>();
  let nodes = 0;
  let bytes = 0;

  const spend = (amount: number) => {
    bytes += amount;
    if (bytes > MAX_PROPOSAL_STATE_BYTES) throw new ProposalStorageContractError("KP_STATE_TOO_LARGE");
  };
  const stringBytes = (value: string) => {
    // Даже ASCII-строка с кавычками уже не поместится; не создаём её большую сериализованную копию.
    if (value.length + 2 > MAX_PROPOSAL_STATE_BYTES - bytes) {
      throw new ProposalStorageContractError("KP_STATE_TOO_LARGE");
    }
    // JSON допускает экранированные NUL/одиночные суррогаты, PostgreSQL JSONB их не принимает.
    validateJsonbString(value);
    spend(Buffer.byteLength(JSON.stringify(value), "utf8"));
  };

  const visit = (value: unknown, depth: number): ProposalJsonValue => {
    nodes++;
    if (depth > MAX_PROPOSAL_STATE_DEPTH || nodes > MAX_PROPOSAL_STATE_NODES) invalidState();
    if (value === null) { spend(4); return null; }
    if (typeof value === "string") { stringBytes(value); return value; }
    if (typeof value === "boolean") { spend(value ? 4 : 5); return value; }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) invalidState();
      spend(Buffer.byteLength(JSON.stringify(value), "utf8"));
      return value;
    }
    if (typeof value !== "object" || ancestors.has(value)) invalidState();
    const array = Array.isArray(value);
    const prototype: unknown = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) invalidState();
    const keys = Reflect.ownKeys(value);
    ancestors.add(value);
    try {
      if (array) {
        // Собственные дополнительные поля и разреженные массивы JSON.stringify теряет или меняет.
        if (value.length > MAX_PROPOSAL_STATE_NODES - nodes || keys.length !== value.length + 1) invalidState();
        spend(2 + Math.max(0, value.length - 1));
        const result: ProposalJsonValue[] = [];
        for (let index = 0; index < value.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalidState();
          const child: unknown = descriptor.value;
          result.push(visit(child, depth + 1));
        }
        return result;
      }
      if (keys.length > MAX_PROPOSAL_STATE_NODES - nodes) invalidState();
      spend(2 + Math.max(0, keys.length - 1));
      const result: ProposalJsonObject = {};
      for (const key of keys) {
        if (typeof key !== "string" || dangerousKeys.has(key)) invalidState();
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalidState();
        stringBytes(key);
        spend(1);
        const child: unknown = descriptor.value;
        result[key] = visit(child, depth + 1);
      }
      return result;
    } finally {
      ancestors.delete(value);
    }
  };
  return visit(input, 0);
}

/** Дополнительные JSON-поля генератора сохраняются без нормализации или удаления. */
export function parseProposalState(input: unknown): ProposalState {
  const state = cloneJson(input);
  if (!isObject(state) || !Array.isArray(state.items) || !state.items.every(isObject)) invalidState();
  return state as ProposalState;
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
}

/** Привязка описывает цель, но никогда не содержит ключи доступа или подписанные URL. */
export function parseProposalStorageBinding(input: unknown): ProposalStorageBinding {
  const invalid = (): never => { throw new ProposalStorageContractError("KP_STORAGE_BINDING_INVALID"); };
  let value: ProposalJsonValue;
  try { value = cloneJson(input); } catch { return invalid(); }
  if (!isObject(value) || Object.keys(value).some(key => !["endpoint", "bucket", "region"].includes(key))) return invalid();
  const { endpoint, bucket, region } = value;
  if (typeof endpoint !== "string" || !/^https?:\/\//iu.test(endpoint) || /[\\?#\s]/u.test(endpoint) || hasControlCharacters(endpoint) ||
    typeof bucket !== "string" || !bucket || Array.from(bucket).length > 255 || /[\\/\s]/u.test(bucket) || hasControlCharacters(bucket) ||
    (region !== undefined && (typeof region !== "string" || !region || Array.from(region).length > 255 || /\s/u.test(region) || hasControlCharacters(region)))) return invalid();
  let url: URL;
  try { url = new URL(endpoint); } catch { return invalid(); }
  if (!["http:", "https:"].includes(url.protocol) || !url.host || url.username || url.password || url.search || url.hash) return invalid();
  return { endpoint, bucket, ...(region === undefined ? {} : { region }) };
}

/** Ключи — непрозрачные ASCII-идентификаторы; исходное имя файла хранится отдельно. */
export function parseProposalObjectKey(input: unknown): string {
  if (typeof input !== "string" || input.length < 4 || input.length > 1024 || !/^kp\/[A-Za-z0-9][A-Za-z0-9/._-]*$/u.test(input) ||
    hasControlCharacters(input) || input.split("/").some(part => !part || part === "." || part === "..")) {
    throw new ProposalStorageContractError("KP_OBJECT_KEY_INVALID");
  }
  return input;
}
