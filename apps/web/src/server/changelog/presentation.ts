import { z } from "zod";
import type { JournalChange, JournalContext, JournalEntityReference, JournalEntryInput, JournalPresentation, JournalPresentationHints, JournalValue } from "./contract";
import { journalActionLabel, journalEntityLabel, journalEnumLabel, journalFieldLabel, journalSourceLabel } from "./labels";

const HIDDEN = "[скрыто]";
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export const JOURNAL_RECEIPT_RULES = [
  { entity: "task", action: "task.status.request", prefix: "task-status:" },
  { entity: "task", action: "task.create.request", prefix: "task-create:" },
  { entity: "task", action: "worker-allocation.receipt", prefix: "worker-task:" },
  { entity: "task", action: "task.reassignment.receipt.v1", prefix: "task-reassignment-v1:" },
  { entity: "product", action: "inline.receipt", prefix: "product-inline:" },
  { entity: "project", action: "cover.receipt", prefix: "project-cover:" },
  { entity: "product", action: "cover.upload", prefix: "product-sketch:" },
  { entity: "product", action: "cover.bind", prefix: "product-sketch:" },
  { entity: "product", action: "cover.delete.receipt", prefix: "product-sketch:" },
  { entity: "work", action: "work-create.receipt", prefix: "work-create:" },
  { entity: "work", action: "work-update.receipt", prefix: "work-update:" },
  { entity: "commercialProposal", action: "kp.write.receipt", prefix: "kp:mutation:" },
] as const;

export function classifyJournalEntry(entry: JournalEntryInput): JournalPresentation["kind"] {
  if (["calendarEntry", "calendarReminderFact", "telegramReminderOutbox", "personalPlan"].includes(entry.entity)) return "excluded";
  return JOURNAL_RECEIPT_RULES.some(rule => entry.entity === rule.entity && entry.action === rule.action && entry.id?.startsWith(rule.prefix)) ? "receipt" : "event";
}

function secretField(path: string): boolean {
  const parts = path.split(".");
  const key = (parts.at(-1) ?? "").replace(/[^a-zа-я0-9]/gi, "").toLowerCase();
  if (/(?:id|ids|changed|enabled|prefix|expiresat|expiration|present|configured|count)$/.test(key)) return false;
  if (/^(?:password|passwordhash|passphrase|token|tokens|secret|secrets|credentials|authorization|cookie|setcookie|databaseurl|connectionstring|linkcode|otp|onetimecode|codeverifier|codechallenge|apikey|privatekey|secretaccesskey|awsaccesskeyid)$/.test(key)) return true;
  if (/(?:password|passphrase|token|secret|privatekey|apikey|credential)/.test(key)) return true;
  return key === "code" && /(?:telegramlink|authentication|authorization|oauth|session|apitoken)/i.test(parts.slice(0, -1).join("."));
}

function safeText(text: string): string {
  if (/^data:[^,]+,/i.test(text)) return "[Двоичные данные]";
  if (/^\s*[\[{]/.test(text) && /password|token|secret|private.?key|authorization|link.?code/i.test(text)) {
    try { const parsed: unknown = JSON.parse(text); if (object(parsed) || Array.isArray(parsed)) return JSON.stringify(sanitizeJournalValue(parsed)); }
    catch { /* Обычный текст не обязан быть JSON. */ }
  }
  return text
    // Формат выданного CRM API-токена: pero_ и 24 случайных байта в base64url.
    .replace(/\bpero_[A-Za-z0-9_-]{32}(?![A-Za-z0-9_-])/g, HIDDEN)
    .replace(/-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )*PRIVATE KEY-----/g, HIDDEN)
    .replace(/\b(Bearer|Basic)(\s+)[^\s"'<>]+/gi, `$1$2${HIDDEN}`)
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, `$1${HIDDEN}@`)
    .replace(/([?&])([^=&#\s]+)=([^&#\s]*)/g, (match, separator: string, encodedKey: string) => {
      let key = encodedKey; try { key = decodeURIComponent(encodedKey); } catch { /* Повреждённый URL остаётся текстом. */ }
      return secretField(key) || /^(?:code|sig|signature|x-amz-(?:signature|credential|security-token))$/i.test(key)
        ? `${separator}${encodedKey}=${HIDDEN}` : match;
    });
}

/** Очистка влияет только на представление. Исходные аудиторские факты не редактируются. */
export function sanitizeJournalValue(value: unknown, key = ""): JournalValue {
  const visited = new WeakSet<object>();
  function visit(current: unknown, path: string): JournalValue {
    if (secretField(path)) return HIDDEN;
    if (current === null || current === undefined) return null;
    if (typeof current === "string") return safeText(current);
    if (typeof current === "number") return Number.isFinite(current) ? current : String(current);
    if (typeof current === "boolean") return current;
    if (typeof current === "bigint") return String(current);
    if (typeof current !== "object") return String(current);
    if (ArrayBuffer.isView(current)) return `[Двоичные данные: ${current.byteLength} байт]`;
    if (current instanceof ArrayBuffer) return `[Двоичные данные: ${current.byteLength} байт]`;
    if (visited.has(current)) return "[Циклическая ссылка]";
    visited.add(current);
    try {
      if (current instanceof Date) return Number.isNaN(current.getTime()) ? "Некорректная дата" : current.toISOString();
      if ("toJSON" in current && typeof current.toJSON === "function") return visit(current.toJSON(), path);
      if (object(current) && current.type === "Buffer" && Array.isArray(current.data)) return `[Двоичные данные: ${current.data.length} байт]`;
      if (Array.isArray(current)) return current.map((item, index) => visit(item, `${path}.${index}`));
      return Object.fromEntries(Object.entries(current).map(([name, item]) => [name, visit(item, path ? `${path}.${name}` : name)]));
    } finally { visited.delete(current); }
  }
  return visit(value, key);
}

function safeHref(href: string | undefined): string | undefined {
  return href?.startsWith("/") && !href.startsWith("//") && !/[\\\u0000-\u001f\u007f]/.test(href) ? href : undefined;
}

function defaultHref(entity: string, id: string): string | undefined {
  const base: Record<string, string> = { project: "/projects/", product: "/products/", task: "/tasks/" };
  return base[entity] ? `${base[entity]}${encodeURIComponent(id)}` : undefined;
}

function safeReference(reference: JournalEntityReference): JournalEntityReference {
  return { type: safeText(reference.type), id: safeText(reference.id), label: safeText(reference.label), ...(safeHref(reference.href) ? { href: reference.href } : {}) };
}

function safeContexts(contexts: JournalContext[]): JournalContext[] {
  const unique = new Map<string, JournalContext>();
  for (const context of contexts) {
    const key = `${context.kind}:${context.id}`;
    if (context.id && !unique.has(key)) unique.set(key, { kind: context.kind, id: safeText(context.id), label: safeText(context.label), ...(safeHref(context.href) ? { href: context.href } : {}) });
  }
  return [...unique.values()];
}

function recordValue(value: unknown, key: string): unknown { return object(value) && own(value, key) ? value[key] : undefined; }

/** Имя сущности задаёт контекст вложенных полей, но само по себе не является секретным полем снимка. */
function safeEntryValue(entry: JournalEntryInput, value: unknown, field = entry.field ?? ""): JournalValue {
  if (!field && value == null) return null;
  return sanitizeJournalValue(value, field || (object(value) ? `${entry.entity}.$value` : entry.entity));
}

function defaultEntity(entry: JournalEntryInput, hints: JournalPresentationHints): JournalEntityReference {
  const label = journalEntityLabel(entry.entity);
  const savedNumber = recordValue(entry.newValue, "number") ?? recordValue(entry.oldValue, "number");
  const savedName = ["fileName", "name", "title"].map(key => recordValue(entry.newValue, key) ?? recordValue(entry.oldValue, key)).find(value => typeof value === "string" && value.trim());
  const number = (typeof savedNumber === "number" || typeof savedNumber === "string") ? String(savedNumber) : undefined;
  const display = number ? `${label} ${number}` : typeof savedName === "string" ? `${label} «${savedName}»` : `${label} (название не сохранено)`;
  return safeReference({ type: entry.entity, id: entry.entityId, label: display, href: defaultHref(entry.entity, entry.entityId), ...hints.entity });
}

function snapshots(entry: JournalEntryInput, hints: JournalPresentationHints) {
  let before = own(hints, "before") ? hints.before : entry.oldValue;
  let after = own(hints, "after") ? hints.after : entry.newValue;
  const isSnapshot = (value: unknown) => object(value) && typeof value.toJSON !== "function";
  let field = (own(hints, "before") || own(hints, "after")) && (isSnapshot(before) || isSnapshot(after)) ? "" : entry.field ?? "";
  if (field && entry.action === "inline.update" && !own(hints, "before") && !own(hints, "after")) {
    if (object(before) && own(before, "technicalSpecifications") && object(after) && own(after, "technicalSpecifications")) {
      before = { technicalSpecifications: before.technicalSpecifications }; after = { technicalSpecifications: after.technicalSpecifications }; field = "";
    } else {
      if (object(before) && own(before, "value")) before = before.value;
      if (object(after) && object(after.result) && own(after.result, "value")) after = after.result.value;
    }
  }
  // Старые stage/status квитанции содержат значение рядом с fingerprint.
  if (field) {
    if (object(before) && own(before, field)) before = before[field];
    if (object(after) && own(after, field)) after = after[field];
  }
  const creating = entry.action === "create";
  const deleting = ["delete", "soft-delete"].includes(entry.action);
  return { before: safeEntryValue(entry, before, field), after: safeEntryValue(entry, after, field), rawBefore: before, rawAfter: after, field,
    beforeKnown: hints.beforeKnown ?? (own(hints, "before") || (before !== undefined && before !== null) || creating),
    afterKnown: hints.afterKnown ?? (own(hints, "after") || (after !== undefined && after !== null) || deleting),
    completeBefore: own(hints, "before") || creating, completeAfter: own(hints, "after") || deleting,
    hasValue: before !== undefined && before !== null || after !== undefined && after !== null || own(hints, "before") || own(hints, "after") };
}

function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (object(left) && typeof left.toJSON === "function") return equal(left.toJSON(), right);
  if (object(right) && typeof right.toJSON === "function") return equal(left, right.toJSON());
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, index) => equal(item, right[index]!));
  if (object(left) && object(right)) {
    const keys = Object.keys(left); return keys.length === Object.keys(right).length && keys.every(key => own(right, key) && equal(left[key], right[key]));
  }
  return false;
}

function percentageValue(value: JournalValue, path: string, entity: string): string | undefined {
  const field = path.split(".").at(-1);
  const digits = field === "percentBps" && ["logisticsTrip", "logisticsPosting", "logisticsDocument"].includes(entity) ? 2
    : field === "shareUnits" && ["product", "payrollEntry", "task", "taskAllocationGroup", "work"].includes(entity) ? 4 : null;
  if (digits === null) return undefined;
  // В обоих доменах 100% — целая шкала; строковое деление сохраняет все сотые/десятитысячные процента.
  const maximum = digits === 2 ? 10_000 : 1_000_000;
  const integer = typeof value === "number" && Number.isSafeInteger(value) ? value
    : typeof value === "string" && /^\d{1,7}$/.test(value) ? Number(value) : null;
  if (integer === null || integer < 0 || integer > maximum) return undefined;
  const text = String(integer).padStart(digits + 1, "0"), fraction = text.slice(-digits).replace(/0+$/, "");
  return `${text.slice(0, -digits)}${fraction ? `,${fraction}` : ""} %`;
}

export function formatJournalDisplayValue(value: JournalValue, path: string, entity: string, links: JournalEntityReference[] = []): JournalValue {
  const percentage = percentageValue(value, path, entity);
  if (percentage !== undefined) return percentage;
  if (typeof value === "string") {
    const key = path.split(".").at(-1) ?? "";
    if (/(?:Id|Ids)$/.test(key)) { const link = links.find(item => item.id === value); if (link) return link.label; }
    return journalEnumLabel(path, value, entity);
  }
  if (Array.isArray(value)) return value.map(item => formatJournalDisplayValue(item, path, entity, links));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, formatJournalDisplayValue(item as JournalValue, path ? `${path}.${key}` : key, entity, links)]));
  return value;
}

function diff(entry: JournalEntryInput, hints: JournalPresentationHints, links: JournalEntityReference[]): JournalChange[] {
  const values = snapshots(entry, hints);
  if (!values.hasValue) return [];
  const result: JournalChange[] = [];
  function compare(before: JournalValue, after: JournalValue, rawBefore: unknown, rawAfter: unknown, path: string, beforeKnown: boolean, afterKnown: boolean, presenceChanged = false) {
    if (!presenceChanged && beforeKnown && afterKnown && equal(before, after) && equal(rawBefore, rawAfter)) return;
    if (object(before) || object(after)) {
      // Если тип сменился с объекта на scalar, сравниваем целые значения без потери исходного объекта.
      if ((object(before) || before === null) && (object(after) || after === null)) {
        const oldObject = object(before) ? before : {}; const newObject = object(after) ? after : {};
        const keys = [...new Set([...Object.keys(oldObject), ...Object.keys(newObject)])];
        if (keys.length) {
          for (const key of keys) {
            const oldHas = own(oldObject, key), newHas = own(newObject, key);
            compare((oldObject[key] ?? null) as JournalValue, (newObject[key] ?? null) as JournalValue,
              recordValue(rawBefore, key), recordValue(rawAfter, key), path ? `${path}.${key}` : key,
              beforeKnown && (oldHas || values.completeBefore), afterKnown && (newHas || values.completeAfter), oldHas !== newHas);
          }
          return;
        }
      }
    }
    result.push({ path: path || "value", label: journalFieldLabel(path || "value"),
      before: formatJournalDisplayValue(before, path, entry.entity, links), after: formatJournalDisplayValue(after, path, entry.entity, links),
      beforeKnown, afterKnown });
  }
  compare(values.before, values.after, values.rawBefore, values.rawAfter, values.field, values.beforeKnown, values.afterKnown);
  return result;
}

const technicalFields = new Set(["fingerprint", "requestFingerprint", "uploadFingerprint", "intentHash", "operationId", "clientMutationId", "eventId", "jobId", "tokenId", "schema", "version", "revision", "requestId", "attempt", "errorCode", "lastErrorCode", "noOp", "repeated"]);
function technicalMetadata(value: JournalValue, prefix: string, output: Record<string, JournalValue>) {
  if (Array.isArray(value)) { value.forEach((item, index) => technicalMetadata(item, `${prefix}.${index}`, output)); return; }
  if (!object(value)) return;
  for (const [key, item] of Object.entries(value)) {
    const path = `${prefix}.${key}`;
    if (technicalFields.has(key)) output[path] = item as JournalValue;
    else if (object(item) || Array.isArray(item)) technicalMetadata(item as JournalValue, path, output);
  }
}

export function buildJournalPresentation(entry: JournalEntryInput, hints: JournalPresentationHints = {}): JournalPresentation {
  const classified = classifyJournalEntry(entry);
  const kind = classified === "excluded" ? classified : hints.kind ?? classified;
  const automatic = entry.actorType === "system" || entry.actorType === "plugin";
  const actor = hints.actor ?? { type: automatic ? "system" as const : "user" as const, id: automatic ? "system" : entry.actorId, name: automatic ? "Система" : entry.actorName || "Имя не сохранено" };
  const entity = defaultEntity(entry, hints);
  const contexts: JournalContext[] = hints.contexts ?? ((entry.entity === "project" || entry.entity === "product")
    ? [{ kind: entry.entity, id: entry.entityId, label: entity.label, ...(entity.href ? { href: entity.href } : {}) }] : []);
  const links = (hints.links ?? []).map(safeReference);
  const technical: Record<string, JournalValue> = { id: entry.id ?? null, actorType: entry.actorType, actorId: entry.actorId,
    entity: entry.entity, entityId: entry.entityId, action: entry.action, field: entry.field ?? null, source: entry.source ?? "web",
    createdAt: sanitizeJournalValue(entry.createdAt) };
  technicalMetadata(safeEntryValue(entry, entry.oldValue), "oldValue", technical);
  technicalMetadata(safeEntryValue(entry, entry.newValue), "newValue", technical);
  const changes = hints.changes?.map(change => ({ ...change, label: safeText(change.label), before: sanitizeJournalValue(change.before, change.path), after: sanitizeJournalValue(change.after, change.path) })) ?? diff(entry, hints, links);
  if (hints.changes) technical.explicitFieldLabels = [...new Set(changes.map(change => change.path))];
  return { version: 1, kind, actor: { type: actor.type, id: safeText(actor.id), name: safeText(actor.name) },
    ...(hints.initiator ? { initiator: { id: safeText(hints.initiator.id), name: safeText(hints.initiator.name) } } : {}),
    ...(hints.reason ? { reason: safeText(hints.reason) } : {}), entity, contexts: safeContexts(contexts),
    action: { code: safeText(entry.action), label: journalActionLabel(entry.action) },
    source: { code: safeText(entry.source ?? "web"), label: journalSourceLabel(entry.source ?? "web") },
    changes, links, technical: sanitizeJournalValue(technical) as Record<string, JournalValue> };
}

const valueSchema: z.ZodType<JournalValue> = z.lazy(() => z.union([z.null(), z.boolean(), z.number().finite(), z.string(), z.array(valueSchema), z.record(z.string(), valueSchema)]));
const personSchema = z.object({ id: z.string(), name: z.string() });
const referenceSchema = z.object({ type: z.string(), id: z.string(), label: z.string(), href: z.string().optional() });
const presentationSchema: z.ZodType<JournalPresentation> = z.object({
  version: z.literal(1), kind: z.enum(["event", "receipt", "excluded"]), actor: personSchema.extend({ type: z.enum(["user", "system"]) }),
  initiator: personSchema.optional(), reason: z.string().optional(), entity: referenceSchema,
  contexts: z.array(z.object({ kind: z.enum(["project", "product"]), id: z.string(), label: z.string(), href: z.string().optional() })),
  action: z.object({ code: z.string(), label: z.string() }), source: z.object({ code: z.string(), label: z.string() }),
  changes: z.array(z.object({ path: z.string(), label: z.string(), before: valueSchema, after: valueSchema, beforeKnown: z.boolean(), afterKnown: z.boolean() })),
  links: z.array(referenceSchema), technical: z.record(z.string(), valueSchema),
});

export function parseJournalPresentation(value: unknown): JournalPresentation | null {
  try {
    const parsed = presentationSchema.safeParse(value); if (!parsed.success) return null;
    const safe = sanitizeJournalValue(parsed.data) as unknown as JournalPresentation;
    return { ...safe, entity: safeReference(safe.entity), links: safe.links.map(safeReference), contexts: safeContexts(safe.contexts),
      changes: safe.changes.map(change => ({ ...change, before: sanitizeJournalValue(change.before, change.path), after: sanitizeJournalValue(change.after, change.path) })) };
  } catch { return null; }
}

export function isJournalPresentation(value: unknown): value is JournalPresentation { return parseJournalPresentation(value) !== null; }

export function buildJournalSearchText(entry: JournalEntryInput, presentation: JournalPresentation): string {
  const safe = parseJournalPresentation(presentation) ?? buildJournalPresentation(entry);
  if (safe.kind === "excluded") return "";
  const values = new Set<string>();
  function collect(value: JournalValue, path = "") {
    if (Array.isArray(value)) { value.forEach(item => collect(item, path)); return; }
    if (object(value)) {
      for (const [key, child] of Object.entries(value)) { values.add(key); values.add(journalFieldLabel(key)); collect(child as JournalValue, path ? `${path}.${key}` : key); }
    } else {
      values.add(value === null ? "null" : String(value));
      if (typeof value === "boolean") values.add(value ? "Да" : "Нет");
    }
  }
  collect(sanitizeJournalValue(safe));
  collect(safeEntryValue(entry, entry.oldValue));
  collect(safeEntryValue(entry, entry.newValue));
  const createdAt = entry.createdAt ? new Date(entry.createdAt) : null;
  if (createdAt && !Number.isNaN(createdAt.getTime())) { values.add(createdAt.toISOString()); values.add(createdAt.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })); }
  // JSONB меняет порядок ключей, но не набор значений: индекс должен быть стабильным после сохранения.
  return [...values].sort().join("\n");
}
