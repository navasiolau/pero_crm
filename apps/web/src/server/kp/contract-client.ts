import { createHash } from "node:crypto";
import { contractClone, contractFailure, type ContractClient, type ContractCustomer, type ContractObject, type ContractSettings, type ContractSource } from "./contract-types";

export const CONTRACT_AUTOFILL_FIELDS = ["name", "phone", "email", "registrationAddress", "passport"] as const;
type AutoField = typeof CONTRACT_AUTOFILL_FIELDS[number];
type Overrides = Partial<Record<AutoField, string>>;
export type ContractDefaults = { customer: Pick<ContractCustomer, AutoField>; deliveryAddress: string };
export type ContractSettingsDocument = { schema: 1; value: ContractSettings; autofill: { clientId: string | null; customer: Overrides; deliveryAddress?: string } };
const text = (value: string | null | undefined) => value?.trim() ?? "";

/** Заказчик берётся из CP.clientId; данные проекта не перепривязывают КП. */
export function contractClientDefaults(client: ContractClient | null, temporaryClientId: string, deliveryAddress: string | null): ContractDefaults {
  const selected = client && client.id !== temporaryClientId ? client : null;
  return { customer: { name: selected ? [text(selected.lastName), text(selected.name), text(selected.middleName)].filter(Boolean).join(" ") : "",
    phone: text(selected?.phone), email: text(selected?.email), registrationAddress: text(selected?.address),
    passport: [text(selected?.passportNumber), text(selected?.passportIssuedBy)].filter(Boolean).join("\n") }, deliveryAddress: text(deliveryAddress) };
}

export function contractFingerprint(value: unknown): string {
  const ancestors = new WeakSet<object>();
  let nodes = 0, bytes = 0;
  const invalid = (): never => contractFailure("CONTRACT_JSON_INVALID", "Некорректные или слишком сложные настройки договора", 400);
  const spend = (text: string) => { bytes += Buffer.byteLength(text, "utf8"); if (bytes > 2 * 1024 * 1024) invalid(); return text; };
  const quote = (text: string) => {
    if (text.length > 2 * 1024 * 1024) invalid();
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (code === 0 || code >= 0xdc00 && code <= 0xdfff) invalid();
      if (code >= 0xd800 && code <= 0xdbff) { const next = text.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) invalid(); }
    }
    return spend(JSON.stringify(text));
  };
  function canonical(current: unknown, depth: number): string {
    if (++nodes > 100_000 || depth > 64) invalid();
    if (current === null || typeof current === "boolean") return spend(JSON.stringify(current));
    if (typeof current === "string") return quote(current);
    if (typeof current === "number") return Number.isFinite(current) ? spend(JSON.stringify(current)) : invalid();
    if (!current || typeof current !== "object" || ancestors.has(current)) return invalid();
    const array = Array.isArray(current);
    if (array && current.length > 100_000 - nodes) invalid();
    const proto: unknown = Object.getPrototypeOf(current), keys = Reflect.ownKeys(current);
    if (array ? proto !== Array.prototype || keys.length !== current.length + 1 : proto !== Object.prototype && proto !== null) invalid();
    if (!array && keys.length > 100_000 - nodes) invalid();
    const stringKeys = keys.map(key => typeof key === "string" ? key : invalid());
    ancestors.add(current);
    try {
      const names = array ? Array.from({ length: current.length }, (_, index) => String(index)) : stringKeys.sort();
      if (names.length > 100_000 - nodes) invalid();
      spend(array ? "[]" : "{}"); if (names.length) spend(",".repeat(names.length - 1));
      const values = names.map(key => {
        if (typeof key !== "string" || ["__proto__", "prototype", "constructor"].includes(key)) return invalid();
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return invalid();
        return (array ? "" : quote(key) + spend(":")) + canonical(descriptor.value as unknown, depth + 1);
      });
      return (array ? "[" : "{") + values.join(",") + (array ? "]" : "}");
    } finally { ancestors.delete(current); }
  }
  return createHash("sha256").update(canonical(value, 0)).digest("hex");
}
export function contractClientBaseline(sources: readonly ContractSource[], clients: readonly ContractClient[]): string {
  const byId = new Map(clients.map(client => [client.id, client]));
  return contractFingerprint(sources.map(source => ({ proposalId: source.proposalId, clientId: source.clientId,
    projectId: source.project?.id ?? null, projectClientId: source.project?.clientId ?? null, deliveryAddress: source.project?.address ?? null,
    client: source.clientId ? byId.get(source.clientId) ?? null : null })));
}
export function settingsDocument(value: ContractObject): ContractSettingsDocument | null {
  if (value.schema !== 1 || !value.value || typeof value.value !== "object" || Array.isArray(value.value) ||
    !value.autofill || typeof value.autofill !== "object" || Array.isArray(value.autofill)) return null;
  const meta = value.autofill;
  if (typeof meta.clientId !== "string" && meta.clientId !== null || !meta.customer || typeof meta.customer !== "object" || Array.isArray(meta.customer)) return null;
  const customer: Overrides = {};
  for (const field of CONTRACT_AUTOFILL_FIELDS) if (typeof meta.customer[field] === "string") customer[field] = meta.customer[field];
  return { schema: 1, value: value.value as ContractSettings, autofill: { clientId: meta.clientId, customer,
    ...(typeof meta.deliveryAddress === "string" ? { deliveryAddress: meta.deliveryAddress } : {}) } };
}

export function applyContractDefaults(settings: ContractSettings, defaults: ContractDefaults, clientId: string | null,
  stored: ContractSettingsDocument | null, hadStoredSettings: boolean): ContractSettings {
  const result = contractClone(settings);
  const sameClient = !stored || stored.autofill.clientId === clientId;
  for (const field of CONTRACT_AUTOFILL_FIELDS) {
    const explicit = sameClient ? stored?.autofill.customer[field] : undefined;
    result.customer[field] = explicit !== undefined ? explicit : stored ? defaults.customer[field] : defaults.customer[field] || (sameClient && hadStoredSettings ? result.customer[field] : "");
  }
  result.deliveryAddress = sameClient && stored?.autofill.deliveryAddress !== undefined ? stored.autofill.deliveryAddress : stored ? defaults.deliveryAddress : defaults.deliveryAddress || result.deliveryAddress;
  return result;
}

export function captureContractSettings(settings: ContractSettings, defaults: ContractDefaults, clientId: string | null,
  previous: ContractSettingsDocument | null): ContractSettingsDocument {
  const customer: Overrides = {};
  for (const field of CONTRACT_AUTOFILL_FIELDS) if (settings.customer[field] !== defaults.customer[field] ||
    previous?.autofill.clientId === clientId && previous.autofill.customer[field] === settings.customer[field]) customer[field] = settings.customer[field];
  const deliveryOverride = settings.deliveryAddress !== defaults.deliveryAddress ||
    previous?.autofill.clientId === clientId && previous.autofill.deliveryAddress === settings.deliveryAddress;
  return { schema: 1, value: contractClone(settings), autofill: { clientId, customer,
    ...(deliveryOverride ? { deliveryAddress: settings.deliveryAddress } : {}) } };
}
