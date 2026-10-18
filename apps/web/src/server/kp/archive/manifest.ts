import {
  HISTORICAL_COUNTS, archiveAssert, archiveId, byteHash, canonical, isObject, jsonClone, parseSourceProfile, parseTargetProfile, sameStorageResource, sourceImageKey, valueHash,
  type ArchiveDependencies, type ArchiveDocx, type ArchiveManifest, type ArchiveMedia, type ArchiveObject, type ArchiveProposal, type ArchiveSettings,
  type ArchiveSource, type DocxBinding, type JsonObject, type SourceArea, type SourceObject, type TargetProfile, type UnknownFact,
} from "./contract";
import { parseArchiveRecoveryMap, validateManifestRecovery } from "./recovery-contract";

const legacyIdPattern = /^([0-9]{13})-[a-z0-9]{7}$/;
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const imageTargetKey = (proposalId: string, mediaId: string, role: "original" | "optimized", source: SourceObject) => `kp/proposals/${proposalId}/${role}/${mediaId}_${source.sha256}.${source.mimeType === "image/png" ? "png" : source.mimeType === "image/webp" ? "webp" : "jpg"}`;
export const sourceLimit = (area: SourceArea, key: string) => key.startsWith("exports/") ? 128 * 1024 * 1024 : key.startsWith("kp/") ? 15 * 1024 * 1024 : area === "contracts" ? 2 * 1024 * 1024 : 512 * 1024;
function sourceDate(value: unknown): string {
  archiveAssert(typeof value === "number" && Number.isSafeInteger(value) && value > 0 || typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value), "ARCHIVE_SOURCE_DATE_UNKNOWN");
  const date = new Date(value as number | string); archiveAssert(Number.isFinite(date.getTime()), "ARCHIVE_SOURCE_DATE_UNKNOWN");
  return date.toISOString();
}
function jsonRecord(bytes: Uint8Array): JsonObject {
  const value: unknown = JSON.parse(Buffer.from(bytes).toString("utf8")); archiveAssert(isObject(value), "ARCHIVE_SOURCE_RECORD_INVALID"); return value;
}
function listedModifiedAtMatchesGet(listed: string, received: string | null): boolean {
  if (listed === received) return true;
  // R2 LIST сохраняет миллисекунды, HTTP Last-Modified в GET — только целую секунду.
  // Сам inventory не округляем: его повторный LIST по-прежнему сравнивается буквально.
  if (!received || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.000)?Z$/.test(received)) return false;
  const listTime = Date.parse(listed), getTime = Date.parse(received);
  return Number.isFinite(listTime) && Number.isFinite(getTime) && listTime >= getTime && listTime < getTime + 1000;
}
function currency(state: JsonObject): ArchiveProposal["currency"] {
  const codes: Record<string, ArchiveProposal["currency"]> = { "$": "USD", USD: "USD", "€": "EUR", EUR: "EUR", "₽": "RUB", RUB: "RUB", BYN: "BYN" };
  const code = codes[String(state.currency ?? "$")]; archiveAssert(code, "ARCHIVE_CURRENCY_UNKNOWN"); return code;
}
export function allArchiveObjects(manifest: Pick<ArchiveManifest, "proposals" | "docx">): ArchiveObject[] {
  return [...manifest.proposals.flatMap(proposal => proposal.media.flatMap(media => [...(media.original ? [media.original] : []), media.optimized])), ...manifest.docx.flatMap(docx => docx.artifact ? [docx.artifact] : [])].sort((a, b) => a.id.localeCompare(b.id));
}
export async function sourceInventory(source: ArchiveSource) {
  const lists = await Promise.all([source.list("public", "documents/"), source.list("contracts", "contracts/"), source.list("contracts", "exports/")]);
  const entries = lists.flat().filter(value => value.area === "public" ? value.key.endsWith(".json") : value.key.startsWith("contracts/") ? value.key.endsWith(".json") : value.key.endsWith(".docx"));
  archiveAssert(new Set(entries.map(value => value.area + ":" + value.key)).size === entries.length, "ARCHIVE_SOURCE_DUPLICATE_KEY");
  return entries.sort((a, b) => (a.area + ":" + a.key).localeCompare(b.area + ":" + b.key));
}

export async function prepareArchiveManifest(source: ArchiveSource, targetInput: TargetProfile, deps: ArchiveDependencies, links: Record<string, DocxBinding> = {}, originals: Record<string, string> = {}): Promise<ArchiveManifest> {
  const profile = parseSourceProfile(source.profile()), target = parseTargetProfile(targetInput), namespace = valueHash(profile);
  const recovery = source.recoveryMap ? parseArchiveRecoveryMap(source.recoveryMap(), profile) : undefined;
  archiveAssert(!sameStorageResource(target.storage, profile.public) && !sameStorageResource(target.storage, profile.contracts), "ARCHIVE_TARGET_IS_SOURCE");
  const inventory = await sourceInventory(source), unknowns: UnknownFact[] = [];
  const cache = new Map<string, { object: SourceObject; bytes: Uint8Array }>();
  const load = async (area: SourceArea, key: string) => {
    const cacheKey = area + ":" + key, cached = cache.get(cacheKey); if (cached) return cached;
    const result = await source.read(area, key, sourceLimit(area, key));
    archiveAssert(result.bytes.length > 0 && result.bytes.length <= sourceLimit(area, key), "ARCHIVE_SOURCE_SIZE_INVALID");
    const listed = inventory.find(value => value.area === area && value.key === key);
    archiveAssert(!listed || listed.size === result.bytes.length && (!listed.modifiedAt || listedModifiedAtMatchesGet(listed.modifiedAt, result.modifiedAt)), "ARCHIVE_SOURCE_INVENTORY_CHANGED");
    const value = { object: { area, key, size: result.bytes.length, mimeType: result.mimeType.split(";")[0].trim(), modifiedAt: result.modifiedAt, sha256: byteHash(result.bytes), ...(result.recovery ? { recovery: result.recovery } : {}) }, bytes: result.bytes };
    cache.set(cacheKey, value); return value;
  };
  const proposals: ArchiveProposal[] = [];
  for (const entry of inventory.filter(value => value.area === "public")) {
    archiveAssert(/^documents\/[0-9]{13}-[a-z0-9]{7}\.json$/.test(entry.key), "ARCHIVE_SOURCE_KEY_INVALID");
    const loaded = await load(entry.area, entry.key), raw = jsonRecord(loaded.bytes), legacyId = entry.key.slice(10, -5), matched = legacyIdPattern.exec(legacyId);
    archiveAssert(matched && (raw.id === undefined || raw.id === legacyId) && isObject(raw.state) && Array.isArray(raw.state.items) && raw.state.items.every(isObject), "ARCHIVE_SOURCE_RECORD_INVALID");
    const createdAt = raw.createdAt !== undefined ? sourceDate(raw.createdAt) : sourceDate(Number(matched[1]));
    const updatedAt = sourceDate(raw.updatedAt), id = archiveId("p", namespace, legacyId), mediaByKey = new Map<string, ArchiveMedia>();
    const items: JsonObject[] = [];
    for (let index = 0; index < raw.state.items.length; index++) {
      const item = jsonClone(raw.state.items[index] as JsonObject); item.id = archiveId("i", namespace, legacyId + ":" + index);
      for (const slot of ["image", "image2"] as const) {
        const image = item[slot]; if (image === undefined || image === null || image === "") continue;
        archiveAssert(typeof image === "string", "ARCHIVE_IMAGE_REFERENCE_INVALID");
        const sourceKey = sourceImageKey(profile, image); let media = mediaByKey.get(sourceKey);
        if (!media) {
          const optimized = await load("public", sourceKey); archiveAssert(imageTypes.has(optimized.object.mimeType), "ARCHIVE_IMAGE_TYPE_UNSUPPORTED");
          if (!optimized.object.modifiedAt) unknowns.push({ sourceId: legacyId, field: `images:${sourceKey}:createdAt`, confidence: "unknown", reason: "Метка объекта отсутствует; provenance сохраняет unknown, TTL остаётся от исходного КП" });
          const mediaId = archiveId("m", namespace, legacyId + ":" + sourceKey), jobId = archiveId("upload", namespace, mediaId);
          const objectFor = (role: "original" | "optimized", sourceObject: SourceObject): ArchiveObject => ({ id: archiveId(role, namespace, mediaId), proposalId: id, mediaId, artifactId: null, contractId: null, jobId, role, source: sourceObject, binding: target.storage,
            key: imageTargetKey(id, mediaId, role, sourceObject), sha256: sourceObject.sha256, size: sourceObject.size, mimeType: sourceObject.mimeType });
          let original: ArchiveObject | null = null;
          if (originals[sourceKey]) {
            archiveAssert(/^kp\/[A-Za-z0-9._/-]+$/.test(originals[sourceKey]) && !originals[sourceKey].split("/").some(part => !part || part === "." || part === ".."), "ARCHIVE_SOURCE_KEY_INVALID");
            const originalLoaded = await load("public", originals[sourceKey]); archiveAssert(imageTypes.has(originalLoaded.object.mimeType), "ARCHIVE_IMAGE_TYPE_UNSUPPORTED"); original = objectFor("original", originalLoaded.object);
          } else unknowns.push({ sourceId: legacyId, field: `images:${sourceKey}:original`, confidence: "unknown", reason: "Источник хранит одну ссылку; отдельный original не подтверждён" });
          media = { id: mediaId, proposalId: id, original, optimized: objectFor("optimized", optimized.object), expiresAt: deps.expiry(new Date(createdAt)).toISOString(), fileName: sourceKey.split("/").at(-1)!, jobId };
          mediaByKey.set(sourceKey, media);
        }
        item[slot] = "kp-media:" + media.id;
      }
      items.push(item);
    }
    const state = deps.validateState({ ...raw.state, items });
    const order = isObject(raw.state.order) ? raw.state.order : {};
    proposals.push({ id, legacyId, sourceId: `legacy-r2:${namespace}:${legacyId}`, sourceNumber: order.number === undefined || order.number === null ? null : String(order.number), sourceHash: loaded.object.sha256, sourceObject: loaded.object,
      rawBase64: Buffer.from(loaded.bytes).toString("base64"), createdAt, createdAtConfidence: raw.createdAt !== undefined ? "source" : "IDderived", updatedAt, currency: currency(raw.state), state, versionId: archiveId("v", namespace, legacyId + ":" + loaded.object.sha256), media: [...mediaByKey.values()].sort((a, b) => a.id.localeCompare(b.id)) });
  }
  const byLegacy = new Map(proposals.map(proposal => [proposal.legacyId, proposal]));
  const settings: ArchiveSettings[] = [];
  for (const entry of inventory.filter(value => value.key.startsWith("contracts/"))) {
    archiveAssert(/^contracts\/[0-9]{13}-[a-z0-9]{7}\.json$/.test(entry.key), "ARCHIVE_SOURCE_KEY_INVALID");
    const loaded = await load(entry.area, entry.key), raw = jsonRecord(loaded.bytes), legacyId = entry.key.slice(10, -5), proposal = byLegacy.get(legacyId);
    archiveAssert(proposal && (raw.primaryDocumentId === undefined || raw.primaryDocumentId === legacyId), "ARCHIVE_SETTINGS_PRIMARY_MISSING");
    const sourceSettings = isObject(raw.settings) ? raw.settings : {};
    if (!isObject(raw.settings)) unknowns.push({ sourceId: legacyId, field: "contract.settings", confidence: "unknown", reason: "Исходный черновик не является объектом; оригинальные JSON-байты сохранены" });
    const originalIds = Array.isArray(sourceSettings.proposalIds) ? sourceSettings.proposalIds : [];
    const sourceProposalIds = [...new Set([legacyId, ...originalIds.filter((value): value is string => typeof value === "string" && byLegacy.has(value))])];
    if (originalIds.some(value => typeof value !== "string" || !byLegacy.has(value))) unknowns.push({ sourceId: legacyId, field: "contract.proposalIds", confidence: "unknown", reason: "В исходном черновике есть неподтверждённые связи; raw record сохранён" });
    const normalized = jsonClone(sourceSettings);
    if (Array.isArray(normalized.proposalIds)) normalized.proposalIds = normalized.proposalIds.map(value => typeof value === "string" && byLegacy.has(value) ? byLegacy.get(value)!.id : value);
    settings.push({ id: archiveId("c", namespace, legacyId), proposalId: proposal.id, legacyId, sourceHash: loaded.object.sha256, sourceObject: loaded.object, rawBase64: Buffer.from(loaded.bytes).toString("base64"), updatedAt: sourceDate(raw.updatedAt), settings: normalized, sourceProposalIds: sourceProposalIds.map(value => byLegacy.get(value)!.id) });
    unknowns.push({ sourceId: legacyId, field: "contract.originalCreatedAt", confidence: "unknown", reason: "Исходный settings record содержит только updatedAt" });
  }
  const docx: ArchiveDocx[] = [];
  for (const entry of inventory.filter(value => value.key.startsWith("exports/"))) {
    archiveAssert(/^exports\/[A-Za-z0-9_.-]+\.docx$/.test(entry.key), "ARCHIVE_SOURCE_KEY_INVALID");
    const loaded = await load(entry.area, entry.key), link = links[entry.key], primary = link ? byLegacy.get(link.primaryDocumentId) : undefined;
    archiveAssert(!link || primary && settings.some(value => value.legacyId === link.primaryDocumentId) && link.evidenceSha256 === loaded.object.sha256, "ARCHIVE_DOCX_BINDING_INVALID");
    const artifactId = archiveId("a", namespace, entry.key), contractId = primary ? archiveId("c", namespace, primary.legacyId) : null;
    const artifact: ArchiveObject | null = primary && contractId ? { id: artifactId, proposalId: primary.id, mediaId: null, artifactId, contractId, jobId: archiveId("upload", namespace, artifactId), role: "docx", source: loaded.object, binding: target.storage,
      key: `kp/contracts/${contractId}/exports/${artifactId}.docx`, sha256: loaded.object.sha256, size: loaded.object.size, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } : null;
    docx.push({ sourceObject: loaded.object, primaryDocumentId: primary?.legacyId ?? null, reviewed: link?.reviewed === true, evidenceSha256: link?.evidenceSha256 ?? null, artifact, versionId: archiveId("cv", namespace, entry.key), createdAtConfidence: loaded.object.modifiedAt ? "source" : "unknown" });
    if (!loaded.object.modifiedAt) unknowns.push({ sourceId: entry.key, field: "docx.createdAt", confidence: "unknown", reason: "Источник не подтвердил дату объекта; apply не подставляет текущее время" });
    if (!primary || !link?.reviewed) unknowns.push({ sourceId: entry.key, field: "docx.primaryDocumentId", confidence: "unknown", reason: "Export UUID не записан в settings; нужна проверенная связь" });
    unknowns.push({ sourceId: entry.key, field: "docx.historicalSettings", confidence: "unknown", reason: "Точные настройки выпущенного DOCX не привязаны к export key" });
  }
  archiveAssert(canonical(await sourceInventory(source)) === canonical(inventory), "ARCHIVE_SOURCE_INVENTORY_CHANGED");
  const data: Omit<ArchiveManifest, "sha256"> = { schema: 1, source: profile, sourceNamespace: namespace, target, inventory, ...(recovery ? { recovery } : {}), proposals: proposals.sort((a, b) => a.id.localeCompare(b.id)), settings: settings.sort((a, b) => a.id.localeCompare(b.id)), docx: docx.sort((a, b) => a.sourceObject.key.localeCompare(b.sourceObject.key)), unknowns,
    counts: { proposals: proposals.length, items: proposals.reduce((sum, proposal) => sum + proposal.state.items.length, 0), settings: settings.length, docx: docx.length }, historicalCounts: { ...HISTORICAL_COUNTS } };
  const manifest = { ...data, sha256: valueHash(data) }; validateManifestRecovery(manifest); return manifest;
}

export function validateArchiveManifest(input: unknown, deps: ArchiveDependencies): ArchiveManifest {
  archiveAssert(isObject(input) && input.schema === 1 && typeof input.sha256 === "string" && /^[a-f0-9]{64}$/.test(input.sha256), "ARCHIVE_MANIFEST_INVALID");
  const { sha256, ...data } = input; archiveAssert(valueHash(data) === sha256, "ARCHIVE_MANIFEST_HASH_MISMATCH");
  const manifest = input as unknown as ArchiveManifest;
  archiveAssert(Array.isArray(manifest.proposals) && Array.isArray(manifest.settings) && Array.isArray(manifest.docx) && Array.isArray(manifest.inventory) && Array.isArray(manifest.unknowns), "ARCHIVE_MANIFEST_INVALID");
  archiveAssert(valueHash(parseSourceProfile(manifest.source)) === manifest.sourceNamespace && canonical(parseTargetProfile(manifest.target)) === canonical(manifest.target), "ARCHIVE_MANIFEST_BINDING_MISMATCH");
  archiveAssert(!sameStorageResource(manifest.target.storage, manifest.source.public) && !sameStorageResource(manifest.target.storage, manifest.source.contracts), "ARCHIVE_TARGET_IS_SOURCE");
  const ids = new Set<string>();
  for (const proposal of manifest.proposals) {
    archiveAssert(proposal.id === archiveId("p", manifest.sourceNamespace, proposal.legacyId) && !ids.has(proposal.id), "ARCHIVE_RECORD_ID_MISMATCH"); ids.add(proposal.id);
    const bytes = Buffer.from(proposal.rawBase64, "base64"); archiveAssert(bytes.length <= 512 * 1024 && bytes.toString("base64") === proposal.rawBase64 && byteHash(bytes) === proposal.sourceHash && proposal.sourceObject.sha256 === proposal.sourceHash && proposal.sourceObject.area === "public" && proposal.sourceObject.key === `documents/${proposal.legacyId}.json` && proposal.sourceObject.size === bytes.length, "ARCHIVE_SOURCE_HASH_MISMATCH");
    const raw = jsonRecord(bytes), match = legacyIdPattern.exec(proposal.legacyId);
    archiveAssert(match && (raw.id === undefined || raw.id === proposal.legacyId) && isObject(raw.state) && Array.isArray(raw.state.items) && raw.state.items.every(isObject), "ARCHIVE_SOURCE_RECORD_INVALID");
    archiveAssert(proposal.sourceId === `legacy-r2:${manifest.sourceNamespace}:${proposal.legacyId}` && proposal.createdAt === (raw.createdAt !== undefined ? sourceDate(raw.createdAt) : sourceDate(Number(match[1]))) && proposal.createdAtConfidence === (raw.createdAt !== undefined ? "source" : "IDderived") && proposal.updatedAt === sourceDate(raw.updatedAt), "ARCHIVE_SOURCE_DATE_MISMATCH");
    const expectedItems = raw.state.items.map((value, index) => {
      const item = jsonClone(value as JsonObject); item.id = archiveId("i", manifest.sourceNamespace, proposal.legacyId + ":" + index);
      for (const slot of ["image", "image2"] as const) if (typeof item[slot] === "string" && item[slot]) {
        const key = sourceImageKey(manifest.source, item[slot]); const media = proposal.media.find(row => row.optimized.source.key === key);
        archiveAssert(media, "ARCHIVE_MEDIA_REFERENCE_MISSING"); item[slot] = "kp-media:" + media.id;
      }
      return item;
    });
    archiveAssert(canonical(deps.validateState({ ...raw.state, items: expectedItems })) === canonical(proposal.state), "ARCHIVE_CANONICAL_STATE_MISMATCH");
    archiveAssert(proposal.currency === currency(raw.state) && proposal.versionId === archiveId("v", manifest.sourceNamespace, proposal.legacyId + ":" + proposal.sourceHash), "ARCHIVE_RECORD_ID_MISMATCH");
    for (const media of proposal.media) {
      archiveAssert(media.proposalId === proposal.id && media.id === archiveId("m", manifest.sourceNamespace, proposal.legacyId + ":" + media.optimized.source.key) && media.expiresAt === deps.expiry(new Date(proposal.createdAt)).toISOString() && media.jobId === archiveId("upload", manifest.sourceNamespace, media.id), "ARCHIVE_MEDIA_DATE_OR_OWNER_MISMATCH");
      for (const object of [...(media.original ? [media.original] : []), media.optimized]) archiveAssert(object.mediaId === media.id && object.proposalId === proposal.id && object.jobId === media.jobId && object.id === archiveId(object.role, manifest.sourceNamespace, media.id) && object.source.area === "public" && /^kp\/[A-Za-z0-9._/-]+$/.test(object.source.key) && imageTypes.has(object.mimeType) && object.role !== "docx" && object.key === imageTargetKey(proposal.id, media.id, object.role, object.source), "ARCHIVE_OBJECT_OWNER_MISMATCH");
    }
  }
  for (const setting of manifest.settings) {
    const bytes = Buffer.from(setting.rawBase64, "base64"), raw = jsonRecord(bytes), proposal = manifest.proposals.find(value => value.legacyId === setting.legacyId);
    archiveAssert(proposal && setting.proposalId === proposal.id && setting.id === archiveId("c", manifest.sourceNamespace, setting.legacyId) && (raw.primaryDocumentId === undefined || raw.primaryDocumentId === setting.legacyId) && byteHash(bytes) === setting.sourceHash && setting.sourceHash === setting.sourceObject.sha256 && setting.sourceObject.key === `contracts/${setting.legacyId}.json` && setting.sourceObject.area === "contracts" && setting.updatedAt === sourceDate(raw.updatedAt), "ARCHIVE_SETTINGS_MISMATCH");
    const expected = jsonClone(isObject(raw.settings) ? raw.settings : {}), byLegacy = new Map(manifest.proposals.map(value => [value.legacyId, value.id]));
    const originalIds = Array.isArray(expected.proposalIds) ? expected.proposalIds : [];
    const linked = [...new Set([setting.legacyId, ...originalIds.filter((value): value is string => typeof value === "string" && byLegacy.has(value))])].map(value => byLegacy.get(value)!);
    if (Array.isArray(expected.proposalIds)) expected.proposalIds = expected.proposalIds.map(value => typeof value === "string" && byLegacy.has(value) ? byLegacy.get(value)! : value);
    archiveAssert(canonical(setting.settings) === canonical(expected) && canonical(setting.sourceProposalIds) === canonical(linked), "ARCHIVE_SETTINGS_MISMATCH");
  }
  archiveAssert(new Set(manifest.settings.map(value => value.id)).size === manifest.settings.length && new Set(manifest.docx.map(value => value.sourceObject.key)).size === manifest.docx.length, "ARCHIVE_SOURCE_DUPLICATE_KEY");
  for (const docx of manifest.docx) {
    archiveAssert(docx.sourceObject.area === "contracts" && /^exports\/[A-Za-z0-9_.-]+\.docx$/.test(docx.sourceObject.key) && docx.versionId === archiveId("cv", manifest.sourceNamespace, docx.sourceObject.key), "ARCHIVE_DOCX_BINDING_INVALID");
    if (docx.artifact) {
      const primary = manifest.proposals.find(value => value.legacyId === docx.primaryDocumentId), contract = manifest.settings.find(value => value.legacyId === docx.primaryDocumentId);
      archiveAssert(primary && contract && docx.artifact.proposalId === primary.id && docx.artifact.contractId === contract.id && docx.artifact.artifactId === archiveId("a", manifest.sourceNamespace, docx.sourceObject.key) && docx.artifact.id === docx.artifact.artifactId && docx.artifact.jobId === archiveId("upload", manifest.sourceNamespace, docx.artifact.id) && canonical(docx.artifact.source) === canonical(docx.sourceObject) && (!docx.reviewed || docx.evidenceSha256 === docx.sourceObject.sha256), "ARCHIVE_DOCX_BINDING_INVALID");
    } else archiveAssert(docx.primaryDocumentId === null && !docx.reviewed, "ARCHIVE_DOCX_BINDING_INVALID");
  }
  const objects = allArchiveObjects(manifest);
  archiveAssert(new Set(objects.map(object => object.id)).size === objects.length && new Set(objects.map(object => object.key)).size === objects.length, "ARCHIVE_OBJECT_DUPLICATE");
  for (const object of objects) archiveAssert(object.sha256 === object.source.sha256 && object.size === object.source.size && object.size > 0 && /^[a-f0-9]{64}$/.test(object.sha256) && canonical(object.binding) === canonical(manifest.target.storage) && object.key.startsWith(object.role === "docx" ? `kp/contracts/${object.contractId}/exports/` : `kp/proposals/${object.proposalId}/${object.role}/`) && !object.key.split("/").some(part => !part || part === "." || part === ".."), "ARCHIVE_OBJECT_OWNER_MISMATCH");
  archiveAssert(canonical(manifest.counts) === canonical({ proposals: manifest.proposals.length, items: manifest.proposals.reduce((sum, proposal) => sum + proposal.state.items.length, 0), settings: manifest.settings.length, docx: manifest.docx.length }), "ARCHIVE_COUNTS_MISMATCH");
  archiveAssert(canonical(manifest.historicalCounts) === canonical(HISTORICAL_COUNTS), "ARCHIVE_HISTORICAL_REFERENCE_CHANGED");
  validateManifestRecovery(manifest);
  return manifest;
}
export function archiveReport(manifest: ArchiveManifest) {
  return { manifestHash: manifest.sha256, counts: manifest.counts, historicalCounts: manifest.historicalCounts, historicalCountsMatch: canonical(manifest.counts) === canonical(manifest.historicalCounts),
    objects: allArchiveObjects(manifest).length, recovery: manifest.recovery ? { mapSha256: valueHash(manifest.recovery), images: manifest.recovery.entries.length, origins: { PDF_DCT: manifest.recovery.entries.filter(row => row.origin.kind === "PDF_DCT").length, LOCAL_FILE: manifest.recovery.entries.filter(row => row.origin.kind === "LOCAL_FILE").length }, originalR2BytesKnown: false } : null,
    unlinkedDocx: manifest.docx.filter(value => !value.reviewed || !value.artifact).map(value => ({ key: value.sourceObject.key, sha256: value.sourceObject.sha256 })), unknowns: manifest.unknowns,
    applicable: manifest.docx.every(value => value.reviewed && value.artifact && value.evidenceSha256 === value.sourceObject.sha256 && value.sourceObject.modifiedAt) };
}
