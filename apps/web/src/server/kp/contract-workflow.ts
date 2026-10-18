import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { applyContractDefaults, captureContractSettings, contractClientBaseline, contractClientDefaults, contractFingerprint, settingsDocument } from "./contract-client";
import { contractDraftRequestSchema, contractExportRequestSchema, contractSourceRefSchema } from "./contract-request";
import { contractClone, contractFailure, type ContractActor, type ContractObject, type ContractSettings, type ContractSource, type ContractSourceRef } from "./contract-types";
import type { ContractArtifact, ContractClaim, ContractFrozenSource, ContractHistoryEntry, ContractPayload, ContractReceipt, ContractTransaction, ContractVerifiedArtifact, ContractWorkflowPorts } from "./contract-ports";

const json = (value: unknown): ContractObject => JSON.parse(JSON.stringify(value)) as ContractObject;
const idList = (refs: readonly ContractSourceRef[]) => refs.map(ref => ref.proposalId);
const sameIds = (first: readonly string[], second: readonly string[]) => first.length === second.length && first.every((value, index) => value === second[index]);
const record = z.record(z.string(), z.json());
const extraSchema = z.object({ contractId: z.string().min(1), primaryId: z.string().min(1), contractRevision: z.number().int().positive(),
  settingsSnapshot: record, clientSnapshot: record, sourceRefs: z.array(contractSourceRefSchema).min(1), sourceBindings: z.array(record).min(1),
  clientBaseline: z.string().regex(/^[a-f0-9]{64}$/), summary: record, profile: record, templateVersion: z.string().min(1), templateSnapshot: record }).strict();

export type ContractPreparedOutput = { pdfs: { proposalId: string; artifact: ContractVerifiedArtifact }[]; docx: ContractVerifiedArtifact; pageCounts: { proposalId: string; pages: number }[] };
export type ContractForm = { contractId: string | null; revision: number; settings: ContractSettings; profiles: ContractObject[];
  sourceRefs: ContractSourceRef[]; clientDefaults: ContractObject; clientBaseline: string; canEdit: boolean; versions: ContractHistoryEntry[] };

function active(source: ContractSource | undefined): ContractSource & { project: NonNullable<ContractSource["project"]> } {
  if (!source || source.deletedAt || source.isArchive || !source.project || source.project.deletedAt) contractFailure("CONTRACT_SOURCE_READ_ONLY", "Архивное или удалённое КП доступно только для чтения", 403);
  return source as ContractSource & { project: NonNullable<ContractSource["project"]> };
}
function orderedSources(rows: readonly ContractSource[], ids: readonly string[]): ContractSource[] {
  return ids.map(id => { const source = rows.find(row => row.proposalId === id); if (!source) contractFailure("CONTRACT_SOURCE_MISSING", "КП договора недоступно", 404); return source; });
}
function validateRefs(primaryId: string, refs: readonly ContractSourceRef[], rows: readonly ContractSource[]): void {
  const ids = idList(refs);
  if (ids[0] !== primaryId || new Set(ids).size !== ids.length) contractFailure("CONTRACT_SOURCE_LIST_INVALID", "Основное КП должно быть первым, повторять КП нельзя", 400);
  for (const ref of refs) {
    const source = active(rows.find(row => row.proposalId === ref.proposalId));
    if (source.revision !== ref.expectedRevision) contractFailure("CONTRACT_SOURCE_CHANGED", "КП изменилось — обновите расчёт договора");
  }
}
function replay(receipt: ContractReceipt | null, actor: ContractActor, fingerprint: string): ContractObject | null {
  if (!receipt) return null;
  if (receipt.actorId !== actor.id || receipt.tokenId !== (actor.tokenId ?? null) || receipt.fingerprint !== fingerprint) contractFailure("CONTRACT_OPERATION_REUSED", "Идентификатор операции уже использован", 400);
  return contractClone(receipt.result);
}
function claimArtifactKey(claim: ContractClaim, kind: "PDF" | "DOCX", ownerId: string, artifactId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(claim.id) || !Number.isInteger(claim.attempt) || claim.attempt < 1) contractFailure("CONTRACT_CLAIM_INVALID", "Некорректная аренда задания");
  return kind === "PDF" ? `kp/proposals/${ownerId}/exports/${claim.id}-${claim.attempt}-${artifactId}.pdf` : `kp/contracts/${ownerId}/exports/${claim.id}-${claim.attempt}-${artifactId}.docx`;
}
function verifiedMatches(artifact: ContractArtifact, verified: ContractVerifiedArtifact): void {
  if (artifact.id !== verified.id || artifact.key !== verified.key || artifact.sha256 !== verified.sha256 || artifact.size !== verified.size ||
    contractFingerprint(artifact.storageBinding) !== contractFingerprint(verified.storageBinding)) contractFailure("CONTRACT_ARTIFACT_MISMATCH", "Проверенный файл не совпадает со снимком задания");
}

export function createContractWorkflow(ports: ContractWorkflowPorts) {
  const enabled = () => { if (!ports.enabled) contractFailure("CONTRACT_DISABLED", "Раздел КП пока выключен", 503); };
  async function context(tx: ContractTransaction, primaryId: string, requestedIds?: readonly string[]) {
    const initial = await tx.sources([primaryId]);
    const primary = initial[0];
    if (!primary) contractFailure("CONTRACT_SOURCE_MISSING", "Основное КП не найдено", 404);
    const initialContract = await tx.contract(primaryId);
    const stored = initialContract ? settingsDocument(initialContract.settings) : null;
    const previousSettings = ports.model.normalizeSettings(stored?.value ?? initialContract?.settings ?? {}, primary.state, primaryId);
    const oldIds = initialContract ? previousSettings.proposalIds : [primaryId];
    const selectedIds = requestedIds ?? oldIds;
    const allIds = [...new Set([primaryId, ...oldIds, ...selectedIds])];
    let sources = await tx.sources(allIds);
    await tx.lockProjects(sources.flatMap(source => source.project ? [source.project.id] : []).sort());
    await tx.lockContract(primaryId);
    const currentContract = await tx.contract(primaryId);
    if ((currentContract?.revision ?? 0) !== (initialContract?.revision ?? 0)) contractFailure("CONTRACT_REVISION_CHANGED", "Договор изменён — обновите форму");
    sources = await tx.sources(allIds);
    const clients = await tx.clients(sources.flatMap(source => source.clientId ? [source.clientId] : []).sort());
    const currentPrimary = sources.find(source => source.proposalId === primaryId)!;
    if (sources.some(source => source.clientId && !clients.some(client => client.id === source.clientId))) contractFailure("CONTRACT_CLIENT_MISSING", "Выбранный клиент КП недоступен");
    const defaults = contractClientDefaults(clients.find(client => client.id === currentPrimary.clientId) ?? null, ports.temporaryClientId, currentPrimary.project?.address ?? null);
    return { primary: currentPrimary, contract: currentContract, stored, previousSettings, clients, defaults,
      sources: orderedSources(sources, selectedIds), oldSources: orderedSources(sources, oldIds) };
  }
  async function form(actor: ContractActor, primaryId: string): Promise<ContractForm> {
    enabled();
    return ports.store.transaction(async tx => {
      await tx.globalLock(); await tx.authorize(actor, "kp:contracts:read");
      const loaded = await context(tx, primaryId);
      return { contractId: loaded.contract?.id ?? null, revision: loaded.contract?.revision ?? 0,
        settings: applyContractDefaults(loaded.previousSettings, loaded.defaults, loaded.primary.clientId, loaded.stored, !!loaded.contract), profiles: contractClone(ports.profiles),
        sourceRefs: loaded.sources.map(source => ({ proposalId: source.proposalId, expectedRevision: source.revision })),
        clientDefaults: json(loaded.defaults), clientBaseline: contractClientBaseline(loaded.sources, loaded.clients),
        versions: loaded.contract ? await tx.history(loaded.contract.id) : [],
        canEdit: !loaded.primary.isArchive && !loaded.primary.deletedAt && !!loaded.primary.project && !loaded.primary.project.deletedAt };
    });
  }
  async function history(actor: ContractActor, primaryId: string): Promise<ContractHistoryEntry[]> {
    enabled();
    return ports.store.transaction(async tx => {
      await tx.globalLock(); await tx.authorize(actor, "kp:contracts:read");
      if (!(await tx.sources([primaryId])).length) contractFailure("CONTRACT_SOURCE_MISSING", "Основное КП не найдено", 404);
      const contract = await tx.contract(primaryId);
      return contract ? tx.history(contract.id) : [];
    });
  }
  async function saveDraft(actor: ContractActor, input: unknown): Promise<ContractObject> {
    enabled();
    const parsed = contractDraftRequestSchema.safeParse(input);
    if (!parsed.success) contractFailure("CONTRACT_REQUEST_INVALID", "Некорректный запрос сохранения договора", 400);
    const request = parsed.data, fingerprint = contractFingerprint({ kind: "draft", request });
    return ports.store.transaction(async tx => {
      await tx.globalLock(); await tx.authorize(actor, "kp:contracts:write");
      const repeated = replay(await tx.receipt(request.operationId), actor, fingerprint); if (repeated) return repeated;
      const loaded = await context(tx, request.documentId, idList(request.sourceRefs));
      active(loaded.primary); validateRefs(request.documentId, request.sourceRefs, loaded.sources);
      if ((loaded.contract?.revision ?? 0) !== request.expectedRevision) contractFailure("CONTRACT_REVISION_CHANGED", "Договор изменён — обновите форму");
      if (request.clientBaseline !== contractClientBaseline(loaded.oldSources, loaded.clients)) contractFailure("CONTRACT_CLIENT_CHANGED", "Реквизиты клиента изменились — обновите форму");
      const settings = ports.model.normalizeSettings(request.settings, loaded.primary.state, request.documentId);
      if (!sameIds(settings.proposalIds, idList(request.sourceRefs))) contractFailure("CONTRACT_SOURCE_CHANGED", "Список КП не совпадает с выбранными источниками");
      const stored = captureContractSettings(settings, loaded.defaults, loaded.primary.clientId, loaded.stored);
      const saved = await tx.saveDraft({ id: loaded.contract?.id ?? randomUUID(), primaryId: request.documentId, expectedRevision: request.expectedRevision,
        create: !loaded.contract, settings: json(stored), sourceIds: settings.proposalIds, actorId: actor.id });
      const result = json({ contractId: saved.id, revision: saved.revision, sourceRefs: request.sourceRefs, clientBaseline: contractClientBaseline(loaded.sources, loaded.clients) });
      await tx.writeReceipt(request.operationId, request.documentId, "contract.draft.save", actor, { actorId: actor.id, tokenId: actor.tokenId ?? null, fingerprint, result });
      return result;
    });
  }
  async function requestExport(actor: ContractActor, input: unknown): Promise<ContractObject> {
    enabled();
    const parsed = contractExportRequestSchema.safeParse(input);
    if (!parsed.success) contractFailure("CONTRACT_REQUEST_INVALID", "Генерация принимает только сохранённый договор и ревизии КП", 400);
    const request = parsed.data, fingerprint = contractFingerprint({ kind: "export", request });
    return ports.store.transaction(async tx => {
      await tx.globalLock(); await tx.authorize(actor, "kp:contracts:generate");
      const repeated = replay(await tx.receipt(request.operationId), actor, fingerprint); if (repeated) return repeated;
      const loaded = await context(tx, request.documentId, idList(request.sourceRefs));
      active(loaded.primary); validateRefs(request.documentId, request.sourceRefs, loaded.sources);
      if (!loaded.contract || loaded.contract.revision !== request.expectedRevision) contractFailure("CONTRACT_REVISION_CHANGED", "Сначала сохраните актуальные настройки договора");
      if (request.clientBaseline !== contractClientBaseline(loaded.sources, loaded.clients)) contractFailure("CONTRACT_CLIENT_CHANGED", "Реквизиты клиента изменились — обновите форму");
      const settings = applyContractDefaults(loaded.previousSettings, loaded.defaults, loaded.primary.clientId, loaded.stored, true);
      if (!sameIds(settings.proposalIds, idList(request.sourceRefs))) contractFailure("CONTRACT_SOURCE_CHANGED", "Сначала сохраните список КП договора");
      const frozen = await ports.lifecycle.freezeSources(tx, actor, request.sourceRefs);
      const ordered = request.sourceRefs.map(ref => {
        const source = frozen.find(value => value.proposalId === ref.proposalId);
        if (!source || source.revision !== ref.expectedRevision || !sameIds([source.projectId], [active(loaded.sources.find(row => row.proposalId === ref.proposalId)).project.id])) contractFailure("CONTRACT_SOURCE_CHANGED", "Снимки КП изменились");
        return source;
      });
      const summary = ports.model.validate(settings, ordered.map(source => ({ id: source.proposalId, updatedAt: Date.parse(loaded.sources.find(row => row.proposalId === source.proposalId)!.updatedAt), state: source.state })), ports.profiles);
      const profile = ports.profiles.find(value => value.id === settings.contractorProfileId);
      if (!profile) contractFailure("CONTRACT_PROFILE_MISSING", "Выберите исполнителя договора", 400);
      const payload: ContractPayload = { schema: 1, actor: { ...actor }, requestFingerprint: fingerprint, frozenSources: contractClone(json({ ordered }).ordered) as unknown as ContractFrozenSource[],
        extra: json({ contractId: loaded.contract.id, contract: { contractId: loaded.contract.id, primaryId: request.documentId, contractRevision: loaded.contract.revision,
          settingsSnapshot: settings, clientSnapshot: { usedCustomer: settings.customer, selectedClientId: loaded.primary.clientId, clients: loaded.clients },
          sourceRefs: request.sourceRefs, sourceBindings: loaded.sources.map(source => ({ proposalId: source.proposalId, projectId: source.project!.id,
            projectStage: source.project!.stage, clientId: source.clientId, projectClientId: source.project!.clientId })),
          clientBaseline: request.clientBaseline, summary, profile, templateVersion: ports.templateVersion, templateSnapshot: ports.templateSnapshot } }) };
      const jobId = randomUUID();
      await tx.createJob({ id: jobId, contractId: loaded.contract.id, dedupeKey: "kp-contract:" + request.operationId, payload, actorId: actor.id });
      const result = json({ id: jobId, state: "PENDING" });
      await tx.writeReceipt(request.operationId, request.documentId, "contract.export.request", actor, { actorId: actor.id, tokenId: actor.tokenId ?? null, fingerprint, result });
      return result;
    });
  }

  async function loadClaim(tx: ContractTransaction, claim: ContractClaim) {
    await tx.globalLock();
    const job = await tx.job(claim.id);
    if (!job || job.kind !== "CONTRACT") contractFailure("CONTRACT_JOB_MISSING", "Задание договора не найдено", 404);
    const payload = ports.lifecycle.parsePayload(job.payload);
    const parsed = extraSchema.safeParse(payload.extra.contract);
    if (!parsed.success || parsed.data.contractId !== job.contractId) contractFailure("CONTRACT_SNAPSHOT_INVALID", "Снимок договора повреждён");
    const extra = parsed.data;
    const actor = await tx.authorize(payload.actor, "kp:contracts:generate");
    if (job.state === "SUCCEEDED") return { job, payload, extra, actor, completed: true as const };
    await ports.lifecycle.assertClaim(tx, claim);
    return { job, payload, extra, actor, completed: false as const };
  }
  async function finalize(claim: ContractClaim, output: ContractPreparedOutput): Promise<ContractObject> {
    enabled();
    const committed = await ports.store.transaction(async tx => {
      const loaded = await loadClaim(tx, claim);
      if (loaded.completed) return { result: loaded.job.result as ContractObject, eventIds: [] as string[] };
      const { payload, extra, actor } = loaded;
      if (extra.templateVersion !== ports.templateVersion || contractFingerprint(extra.templateSnapshot) !== contractFingerprint(ports.templateSnapshot)) contractFailure("CONTRACT_TEMPLATE_CHANGED", "Шаблон договора обновился — повторите генерацию");
      const current = await context(tx, extra.primaryId, idList(extra.sourceRefs));
      validateRefs(extra.primaryId, extra.sourceRefs, current.sources);
      if (!current.contract || current.contract.id !== extra.contractId || current.contract.revision !== extra.contractRevision ||
        extra.clientBaseline !== contractClientBaseline(current.sources, current.clients)) contractFailure("CONTRACT_CLIENT_OR_DRAFT_CHANGED", "Договор или реквизиты изменились во время генерации");
      if (!sameIds(idList(extra.sourceRefs), payload.frozenSources.map(source => source.proposalId)) || payload.frozenSources.some(source => {
        const row = current.sources.find(value => value.proposalId === source.proposalId);
        return !row?.project || row.project.id !== source.projectId || row.project.stage !== source.projectStage || row.clientId !== source.binding.clientId ||
          (source.mode === "render" ? source.projectStage !== "LEAD" : source.projectStage === "LEAD" || row.acceptedVersionId !== source.retainedVersionId || row.acceptedPdfArtifactId !== source.retainedPdfArtifactId);
      })) contractFailure("CONTRACT_SOURCE_CHANGED", "Источники или этапы изменились во время генерации");
      if (!sameIds(output.pageCounts.map(value => value.proposalId), payload.frozenSources.map(source => source.proposalId)) || output.pageCounts.some(value => !Number.isSafeInteger(value.pages) || value.pages < 1)) contractFailure("CONTRACT_PDF_INCOMPLETE", "Не подтверждены страницы всех приложений");
      const rendered = payload.frozenSources.filter(source => source.mode === "render");
      if (!sameIds([...output.pdfs.map(value => value.proposalId)].sort(), rendered.map(source => source.proposalId).sort()) || new Set(output.pdfs.map(value => value.proposalId)).size !== output.pdfs.length) contractFailure("CONTRACT_PDF_INCOMPLETE", "Не подготовлены все PDF договора");
      const docx = await tx.artifact(output.docx.id);
      if (!docx || docx.contractId !== extra.contractId || docx.proposalId !== null || docx.kind !== "DOCX" || docx.state !== "PENDING" ||
        docx.key !== claimArtifactKey(claim, "DOCX", extra.contractId, docx.id)) contractFailure("CONTRACT_ARTIFACT_INVALID", "Файл договора не принадлежит заданию");
      verifiedMatches(docx, output.docx);
      const releases: ContractObject[] = [];
      for (const source of payload.frozenSources) {
        if (source.mode === "render") {
          const value = output.pdfs.find(pdf => pdf.proposalId === source.proposalId)!;
          const published = await ports.lifecycle.publishSourcePdf(tx, claim, source.proposalId, value.artifact);
          releases.push(json({ proposalId: source.proposalId, versionId: published.versionId, pdfArtifactId: published.artifactId }));
        } else {
          const pdf = source.retainedPdfArtifactId ? await tx.artifact(source.retainedPdfArtifactId) : null;
          if (!pdf || pdf.state !== "READY" || pdf.kind !== "PDF" || pdf.proposalId !== source.proposalId || !source.retainedVersionId) contractFailure("CONTRACT_RETAINED_PDF_MISSING", "Принятый PDF КП недоступен", 410);
          releases.push(json({ proposalId: source.proposalId, versionId: source.retainedVersionId, pdfArtifactId: pdf.id }));
        }
      }
      await tx.makeArtifactReady(docx.id);
      const versionId = randomUUID();
      await tx.createContractVersion({ id: versionId, contractId: extra.contractId, settingsSnapshot: extra.settingsSnapshot as ContractObject,
        clientSnapshot: extra.clientSnapshot as ContractObject, sourcesSnapshot: payload.frozenSources.map(source => json(source)),
        renderSnapshot: json({ template: extra.templateSnapshot, profile: extra.profile, releases, pageCounts: output.pageCounts }),
        templateVersion: extra.templateVersion, docxArtifactId: docx.id, actorId: actor.id });
      const eventIds: string[] = [];
      for (const source of payload.frozenSources) if (source.projectStage === "LEAD" || source.projectStage === "ESTIMATE") eventIds.push(...await ports.lifecycle.advanceToContract(tx, actor, source, randomUUID()));
      const result = json({ artifactId: docx.id, versionId, contractId: extra.contractId, fileName: docx.fileName, mimeType: docx.mimeType, releases, pageCounts: output.pageCounts });
      eventIds.push(await tx.event(actor.id, "contract.generated", json({ contractId: extra.contractId, versionId, jobId: claim.id, artifactId: docx.id, tokenId: payload.actor.tokenId ?? null })));
      await tx.completeJob(claim, result);
      return { result, eventIds };
    });
    if (committed.eventIds.length) await ports.dispatchAfterCommit(committed.eventIds).catch(() => undefined);
    return committed.result;
  }

  async function runClaim(claim: ContractClaim): Promise<ContractObject> {
    enabled();
    try {
      const loaded = await ports.store.transaction(tx => loadClaim(tx, claim));
      if (loaded.completed) return loaded.job.result as ContractObject;
      const { payload, extra } = loaded;
      if (extra.templateVersion !== ports.templateVersion || contractFingerprint(extra.templateSnapshot) !== contractFingerprint(ports.templateSnapshot)) contractFailure("CONTRACT_TEMPLATE_CHANGED", "Шаблон договора обновился — повторите генерацию");
      const pdfs: ContractPreparedOutput["pdfs"] = [], rendered: { id: string; images: Uint8Array[] }[] = [], pageCounts: ContractPreparedOutput["pageCounts"] = [];
      async function upload(kind: "PDF" | "DOCX", ownerId: string, bytes: Uint8Array, source?: ContractFrozenSource) {
        const prefix = kind === "PDF" ? [37, 80, 68, 70, 45] : [80, 75];
        if (!bytes.byteLength || bytes.byteLength > 2_147_483_647 || !prefix.every((value, index) => bytes[index] === value)) contractFailure("CONTRACT_RENDER_INVALID", "Генератор вернул некорректный документ", 502);
        const id = randomUUID();
        let artifact: ContractArtifact = { id, proposalId: kind === "PDF" ? ownerId : null, contractId: kind === "DOCX" ? ownerId : null,
          kind, state: "PENDING", storageBinding: contractClone(ports.storageBinding), key: claimArtifactKey(claim, kind, ownerId, id),
          sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.byteLength,
          fileName: kind === "PDF" ? `kp_${ownerId}_Pero.pdf` : ports.fileNameForContract(String(extra.settingsSnapshot.number)),
          mimeType: kind === "PDF" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
        await ports.store.transaction(async tx => {
          const current = await loadClaim(tx, claim);
          if (current.completed) contractFailure("CONTRACT_JOB_COMPLETED", "Задание уже завершено");
          if (kind === "PDF") {
            const prepared = await ports.lifecycle.registerPendingPdf(tx, claim, source!, artifact);
            if (prepared.proposalId !== ownerId || prepared.contractId !== null || prepared.kind !== "PDF" || prepared.state !== "PENDING" ||
              prepared.key !== claimArtifactKey(claim, "PDF", ownerId, prepared.id) || prepared.sha256 !== artifact.sha256 || prepared.size !== artifact.size ||
              contractFingerprint(prepared.storageBinding) !== contractFingerprint(artifact.storageBinding)) contractFailure("CONTRACT_ARTIFACT_MISMATCH", "Подготовленный PDF не принадлежит заданию");
            artifact = prepared;
          } else {
            await tx.createPendingArtifact(artifact);
            await ports.lifecycle.registerPendingDocxCleanup(tx, claim, artifact.id, extra.primaryId);
          }
        });
        const verified = await ports.io.uploadAndVerify(artifact, bytes);
        verifiedMatches(artifact, verified);
        return verified;
      }
      let appendixBytes = 0, appendixPages = 0;
      for (const source of payload.frozenSources) {
        const retained = source.mode === "retained" ? await ports.store.transaction(async tx => {
          const current = await loadClaim(tx, claim);
          if (current.completed) contractFailure("CONTRACT_JOB_COMPLETED", "Задание уже завершено");
          const artifact = source.retainedPdfArtifactId ? await tx.artifact(source.retainedPdfArtifactId) : null;
          if (!artifact || artifact.state !== "READY" || artifact.kind !== "PDF" || artifact.proposalId !== source.proposalId) contractFailure("CONTRACT_RETAINED_PDF_MISSING", "Принятый PDF КП недоступен", 410);
          return artifact;
        }) : null;
        const fresh = source.mode === "render" ? await ports.io.renderPdf(structuredClone(source)) : null;
        const bytes = fresh ? fresh.bytes : await ports.io.retainedPdf(structuredClone(source));
        if (retained && (retained.size !== bytes.byteLength || retained.sha256 !== createHash("sha256").update(bytes).digest("hex"))) contractFailure("CONTRACT_ARTIFACT_MISMATCH", "Принятый PDF не прошёл проверку контрольной суммы");
        if (source.mode === "render") pdfs.push({ proposalId: source.proposalId, artifact: await upload("PDF", source.proposalId, bytes, source) });
        // Свежие страницы — исходные DPR2 screenshots того же Chromium-render, без смены сглаживания.
        const images = fresh ? fresh.pages : await ports.io.rasterizePdf(bytes);
        if (!images.length) contractFailure("CONTRACT_APPENDIX_EMPTY", "Не получены страницы приложения КП", 502);
        appendixPages += images.length;
        appendixBytes += images.reduce((sum, image) => sum + image.byteLength, 0);
        if (appendixPages > 1000 || appendixBytes > 128 * 1024 * 1024 || images.some(image => image.byteLength < 8 || image.byteLength > 16 * 1024 * 1024))
          contractFailure("CONTRACT_APPENDIX_TOO_LARGE", "Приложения договора превышают допустимый объём", 413);
        rendered.push({ id: source.proposalId, images }); pageCounts.push({ proposalId: source.proposalId, pages: images.length });
      }
      const bytes = await ports.io.generateDocx(structuredClone(extra.settingsSnapshot) as ContractSettings, structuredClone(extra.summary) as ContractObject, structuredClone(extra.profile) as ContractObject, rendered);
      const docx = await upload("DOCX", extra.contractId, bytes);
      return finalize(claim, { pdfs, docx, pageCounts });
    } catch (error) {
      const known = error instanceof Error && "code" in error && typeof error.code === "string" && /^[A-Z0-9_]{1,128}$/.test(error.code) &&
        "status" in error && typeof error.status === "number" ? { code: error.code, status: error.status } : null;
      await ports.store.transaction(async tx => { await tx.globalLock(); await tx.failJob(claim, known?.code ?? "CONTRACT_RENDER_FAILED", known !== null && known.status >= 400 && known.status < 500); }).catch(() => undefined);
      throw error;
    }
  }
  return { form, history, saveDraft, requestExport, runClaim, finalize };
}
