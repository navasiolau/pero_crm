import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createContractWorkflow } from "../src/server/kp/contract-workflow";
import { contractClientDefaults, settingsDocument } from "../src/server/kp/contract-client";
import { contractDraftRequestSchema, contractExportRequestSchema } from "../src/server/kp/contract-request";
import { ContractWorkflowError } from "../src/server/kp/contract-types";
import { contractActor, contractClient, contractSettings, contractWorkflowFixture, source } from "./helpers/contract-workflow-fixture";

const conflict = (error: unknown) => error instanceof ContractWorkflowError && error.status === 409;
async function prepare(f = contractWorkflowFixture()) {
  const workflow = createContractWorkflow(f.ports), form = await workflow.form(contractActor, "cp_a");
  const request = { documentId: "cp_a", expectedRevision: form.revision, sourceRefs: form.sourceRefs, clientBaseline: form.clientBaseline, operationId: randomUUID(), settings: form.settings };
  const saved = await workflow.saveDraft(contractActor, request);
  const exportRequest = { documentId: "cp_a", expectedRevision: Number(saved.revision), sourceRefs: saved.sourceRefs, clientBaseline: String(saved.clientBaseline), operationId: randomUUID() };
  const queued = await workflow.requestExport(contractActor, exportRequest);
  return { f, workflow, form, request, saved, exportRequest, queued, claim: f.claim(String(queued.id)) };
}

test('асинхронный отказ публикации записывает безопасную причину и не оставляет успешного выпуска', async () => {
  const prepared = await prepare(), original = prepared.f.ports.store.transaction;
  let recorded = '';
  prepared.f.ports.store.transaction = run => original(tx => run({ ...tx, failJob: async (claim, code, terminal) => { recorded = code; return tx.failJob(claim, code, terminal); } }));
  prepared.f.ports.lifecycle.advanceToContract = async () => { throw Error('PRIVATE_DATABASE_DETAIL'); };
  await assert.rejects(prepared.workflow.runClaim(prepared.claim), /PRIVATE_DATABASE_DETAIL/);
  assert.equal(recorded, 'CONTRACT_PUBLISH_FAILED');
  assert.equal(prepared.f.state.versions.length, 0); assert.equal(prepared.f.state.sourceVersions.length, 0);
  assert.deepEqual(prepared.f.state.stages, []);
});

test("форма берёт текущего клиента КП и адрес проекта, не записывает CRM и не угадывает юрлицо", async () => {
  const f = contractWorkflowFixture(), before = structuredClone(f.state.clients);
  const form = await createContractWorkflow(f.ports).form(contractActor, "cp_a");
  assert.equal(form.settings.customer.name, "Иванов Иван Иванович");
  assert.equal(form.settings.customer.phone, "+70000000000");
  assert.equal(form.settings.customer.email, "fixture@example.invalid");
  assert.equal(form.settings.customer.registrationAddress, "Адрес регистрации");
  assert.equal(form.settings.customer.passport, "TEST-123\nТестовый орган");
  assert.equal(form.settings.deliveryAddress, "Адрес объекта");
  assert.equal(form.settings.customer.type, "individual");
  assert.notEqual(f.state.sources[0].project!.clientId, f.state.sources[0].clientId);
  assert.deepEqual(f.state.clients, before); assert.equal(f.state.contract, null); assert.equal(f.state.jobs.size, 0); assert.deepEqual(f.state.stages, []);
});

test("служебный клиент и отсутствующие сведения не становятся реквизитами заказчика", async () => {
  const defaults = contractClientDefaults({ ...contractClient(), id: "temporary", name: "Временный" }, "temporary", null);
  assert.deepEqual(defaults.customer, { name: "", phone: "", email: "", registrationAddress: "", passport: "" });
  assert.equal(contractClientDefaults({ ...contractClient(), passportNumber: null, passportIssuedBy: null, address: null, email: null }, "temporary", null).customer.passport, "");
  const f = contractWorkflowFixture(); f.state.sources[0].clientId = "temporary"; f.state.clients[0].id = "temporary";
  const workflow = createContractWorkflow(f.ports), form = await workflow.form(contractActor, "cp_a");
  assert.equal(form.settings.customer.name, "");
  form.settings.customer.name = "Заказчик введён вручную";
  await workflow.saveDraft(contractActor, { documentId: "cp_a", expectedRevision: 0, sourceRefs: form.sourceRefs, clientBaseline: form.clientBaseline, operationId: randomUUID(), settings: form.settings });
  assert.equal(f.state.clients.length, 1); assert.equal(f.state.sources[0].clientId, "temporary");
  assert.equal((await workflow.form(contractActor, "cp_a")).settings.customer.name, "Заказчик введён вручную");
});

test("ручные банковские поля и явные исправления сохраняются, остальные defaults обновляются", async () => {
  const f = contractWorkflowFixture();
  f.state.contract = { id: "contract_old", primaryProposalId: "cp_a", revision: 0, settings: { ...contractSettings(), customer: { ...contractSettings().customer, type: "organization", bankDetails: "Ручные реквизиты", taxId: "MANUAL" } } };
  const workflow = createContractWorkflow(f.ports), form = await workflow.form(contractActor, "cp_a");
  assert.equal(form.settings.customer.type, "organization"); assert.equal(form.settings.customer.bankDetails, "Ручные реквизиты");
  form.settings.customer.name = "Ручная редакция имени";
  await workflow.saveDraft(contractActor, { documentId: "cp_a", expectedRevision: 0, sourceRefs: form.sourceRefs, clientBaseline: form.clientBaseline, operationId: randomUUID(), settings: form.settings });
  f.state.clients[0].name = "Новое имя CRM"; f.state.clients[0].phone = "+70000000001"; f.state.clients[0].updatedAt = "2026-10-18T11:00:00Z";
  const fresh = await workflow.form(contractActor, "cp_a");
  assert.equal(fresh.settings.customer.name, "Ручная редакция имени"); assert.equal(fresh.settings.customer.phone, "+70000000001");
  assert.equal(fresh.settings.customer.bankDetails, "Ручные реквизиты");
});

test("очищенные реквизиты CRM очищают автоматические поля и не становятся ручными исключениями", async () => {
  const f = contractWorkflowFixture(), workflow = createContractWorkflow(f.ports);
  const initial = await workflow.form(contractActor, "cp_a");
  await workflow.saveDraft(contractActor, { documentId: "cp_a", expectedRevision: initial.revision, sourceRefs: initial.sourceRefs,
    clientBaseline: initial.clientBaseline, operationId: randomUUID(), settings: initial.settings });
  Object.assign(f.state.clients[0], { passportNumber: null, passportIssuedBy: null, address: null, email: null, updatedAt: "2026-10-18T11:00:00Z" });
  f.state.sources[0].project!.address = null;
  const cleared = await workflow.form(contractActor, "cp_a");
  assert.equal(cleared.settings.customer.passport, ""); assert.equal(cleared.settings.customer.email, "");
  assert.equal(cleared.settings.customer.registrationAddress, ""); assert.equal(cleared.settings.deliveryAddress, "");
  await workflow.saveDraft(contractActor, { documentId: "cp_a", expectedRevision: cleared.revision, sourceRefs: cleared.sourceRefs,
    clientBaseline: cleared.clientBaseline, operationId: randomUUID(), settings: cleared.settings });
  const stored = settingsDocument(f.state.contract!.settings)!;
  assert.equal(Object.hasOwn(stored.autofill.customer, "passport"), false);
  assert.equal(Object.hasOwn(stored.autofill, "deliveryAddress"), false);
});

test("save draft имеет CAS/receipt и не меняет этапы, добавление КП возвращает новый baseline", async () => {
  const f = contractWorkflowFixture([source("cp_a"), source("cp_b")]), workflow = createContractWorkflow(f.ports);
  const form = await workflow.form(contractActor, "cp_a");
  form.settings.proposalIds.push("cp_b");
  const request = { documentId: "cp_a", expectedRevision: 0, sourceRefs: [...form.sourceRefs, { proposalId: "cp_b", expectedRevision: 1 }], clientBaseline: form.clientBaseline, operationId: randomUUID(), settings: form.settings };
  const one = await workflow.saveDraft(contractActor, request), repeated = await workflow.saveDraft(contractActor, request);
  assert.deepEqual(repeated, one); assert.equal(one.revision, 1); assert.notEqual(one.clientBaseline, form.clientBaseline);
  assert.equal(f.state.receipts.size, 1); assert.deepEqual(f.state.stages, []); assert.equal(f.state.versions.length, 0);
  await assert.rejects(workflow.saveDraft(contractActor, { ...request, operationId: randomUUID() }), conflict);
  assert.deepEqual((await workflow.form(contractActor, "cp_a")).sourceRefs, request.sourceRefs);
});

test("изменившиеся реквизиты или привязка после GET дают 409 до сохранения", async () => {
  for (const change of ["client", "binding", "address"] as const) {
    const f = contractWorkflowFixture(), workflow = createContractWorkflow(f.ports), form = await workflow.form(contractActor, "cp_a");
    if (change === "client") f.state.clients[0].passportNumber = "UPDATED";
    if (change === "binding") f.state.sources[0].project!.clientId = "changed_again";
    if (change === "address") f.state.sources[0].project!.address = "Другой объект";
    await assert.rejects(workflow.saveDraft(contractActor, { documentId: "cp_a", expectedRevision: 0, sourceRefs: form.sourceRefs, clientBaseline: form.clientBaseline, operationId: randomUUID(), settings: form.settings }), conflict);
    assert.equal(f.state.contract, null); assert.deepEqual(f.state.stages, []);
  }
});

test("публичный запрос выпуска закрыт от произвольного state/settings и от КП без проекта", async () => {
  const base = { documentId: "cp_a", expectedRevision: 0, sourceRefs: [{ proposalId: "cp_a", expectedRevision: 1 }], clientBaseline: "0".repeat(64), operationId: randomUUID() };
  assert.equal(contractExportRequestSchema.safeParse({ ...base, primaryState: {} }).success, false);
  assert.equal(contractExportRequestSchema.safeParse({ ...base, settings: {} }).success, false);
  assert.equal(contractDraftRequestSchema.safeParse({ ...base, settings: {} }).success, true);
  const f = contractWorkflowFixture(); f.state.sources[0].project = null;
  const workflow = createContractWorkflow(f.ports), form = await workflow.form(contractActor, "cp_a");
  assert.equal(form.canEdit, false);
  await assert.rejects(workflow.saveDraft(contractActor, { ...base, settings: form.settings, clientBaseline: form.clientBaseline }), error => error instanceof ContractWorkflowError && error.status === 403);
  assert.equal(f.state.contract, null);
});

test("ошибка исходной Model не создаёт job и не меняет этапы", async () => {
  const f = contractWorkflowFixture(), workflow = createContractWorkflow(f.ports), form = await workflow.form(contractActor, "cp_a");
  const saved = await workflow.saveDraft(contractActor, { documentId: "cp_a", expectedRevision: 0, sourceRefs: form.sourceRefs, clientBaseline: form.clientBaseline, operationId: randomUUID(), settings: form.settings });
  f.ports.model.validate = () => { throw new ContractWorkflowError("CONTRACT_VALIDATION", 400, "Подтвердите заказчика"); };
  await assert.rejects(workflow.requestExport(contractActor, { documentId: "cp_a", expectedRevision: saved.revision, sourceRefs: saved.sourceRefs, clientBaseline: saved.clientBaseline, operationId: randomUUID() }), /Подтвердите заказчика/);
  assert.equal(f.state.jobs.size, 0); assert.deepEqual(f.state.stages, []);
});

test("успех выпускает всё одной транзакцией и переводит только Лид/Просчёт", async () => {
  const f = contractWorkflowFixture([source("cp_a"), source("cp_b", "ESTIMATE"), source("cp_c", "IN_WORK"), source("cp_d", "PAUSED"), source("cp_e", "REFUSED")]);
  const workflow = createContractWorkflow(f.ports), form = await workflow.form(contractActor, "cp_a");
  const refs = f.state.sources.map(row => ({ proposalId: row.proposalId, expectedRevision: row.revision }));
  form.settings.proposalIds = refs.map(ref => ref.proposalId);
  await workflow.saveDraft(contractActor, { documentId: "cp_a", expectedRevision: 0, sourceRefs: refs, clientBaseline: form.clientBaseline, operationId: randomUUID(), settings: form.settings });
  const saved = await workflow.form(contractActor, "cp_a");
  const exportRequest = { documentId: "cp_a", expectedRevision: saved.revision, sourceRefs: refs, clientBaseline: saved.clientBaseline, operationId: randomUUID() };
  const job = await workflow.requestExport(contractActor, exportRequest);
  assert.deepEqual(await workflow.requestExport(contractActor, exportRequest), job);
  assert.equal(f.state.jobs.size, 1); assert.equal(f.state.versions.length, 0); assert.deepEqual(f.state.stages, []);
  const claim = f.claim(String(job.id)), facts = structuredClone(f.state.financialFacts);
  const result = await workflow.runClaim(claim);
  assert.equal(f.state.jobs.get(claim.id)?.state, "SUCCEEDED"); assert.equal(f.state.versions.length, 1); assert.equal(f.state.sourceVersions.length, 1);
  assert.deepEqual(f.state.stages, ["cp_a", "cp_b"]);
  assert.deepEqual(f.state.sources.map(row => row.project!.stage), ["CONTRACT", "CONTRACT", "IN_WORK", "PAUSED", "REFUSED"]);
  assert.deepEqual(f.state.financialFacts, facts); assert.equal(f.calls.filter(call => call === "dispatch").length, 1);
  assert.ok(f.calls.findIndex(call => call.startsWith("docx-cleanup:")) < f.calls.indexOf("upload:DOCX"));
  assert.equal(f.calls.filter(call => call.startsWith("render:")).length, 1);
  assert.equal([...f.state.artifacts.values()].find(artifact => artifact.kind === "PDF" && artifact.proposalId === "cp_a")?.fileName, "КП_231.pdf");
  const before = f.calls.length; assert.deepEqual(await workflow.runClaim(claim), result); assert.equal(f.calls.length, before + 2);
  const snapshot = structuredClone(f.state.versions[0]); f.state.clients[0].name = "Позднее изменение"; assert.deepEqual(f.state.versions[0], snapshot);
  assert.equal((await workflow.history(contractActor, "cp_a"))[0].docxArtifactId, result.artifactId);
  assert.equal((await workflow.form(contractActor, "cp_a")).versions[0].id, result.versionId);
});

test("история договора без привязки к проекту доступна независимо от неполных текущих настроек", async () => {
  const f = contractWorkflowFixture(); f.state.sources[0].project = null;
  f.state.contract = { id: "historical", primaryProposalId: "cp_a", revision: 0, settings: {} };
  f.state.versions.push({ id: "old_contract", contractId: "historical", docxArtifactId: "old_docx" });
  f.ports.model.normalizeSettings = () => { throw Error("Неполный старый черновик"); };
  const entries = await createContractWorkflow(f.ports).history(contractActor, "cp_a");
  assert.equal(entries.length, 1); assert.equal(entries[0].docxArtifactId, "old_docx");
  assert.deepEqual(Object.keys(entries[0]).sort(), ["id", "createdAt", "docxArtifactId", "fileName"].sort());
  assert.equal(f.state.jobs.size, 0); assert.deepEqual(f.state.stages, []);
});

test("изменения во время рендера не публикуют версии и не переводят проекты", async () => {
  for (const kind of ["client", "proposal", "contract", "stage", "access"] as const) {
    const prepared = await prepare();
    prepared.f.ports.io.generateDocx = async () => {
      if (kind === "client") prepared.f.state.clients[0].phone = "Изменено";
      if (kind === "proposal") prepared.f.state.sources[0].revision++;
      if (kind === "contract") prepared.f.state.contract!.revision++;
      if (kind === "stage") prepared.f.state.sources[0].project!.stage = "ESTIMATE";
      if (kind === "access") prepared.f.revoke();
      return new Uint8Array([80, 75, 3, 4]);
    };
    await assert.rejects(prepared.workflow.runClaim(prepared.claim));
    assert.equal(prepared.f.state.versions.length, 0); assert.equal(prepared.f.state.sourceVersions.length, 0); assert.deepEqual(prepared.f.state.stages, []);
    assert.equal([...prepared.f.state.artifacts.values()].some(artifact => artifact.state === "READY"), false);
  }
});

test("ошибка перехода откатывает все публикации координатора в переданной транзакции", async () => {
  const prepared = await prepare(); prepared.f.failStage();
  await assert.rejects(prepared.workflow.runClaim(prepared.claim), /Stage failure/);
  assert.equal(prepared.f.state.versions.length, 0); assert.equal(prepared.f.state.sourceVersions.length, 0); assert.deepEqual(prepared.f.state.events, []);
  assert.equal([...prepared.f.state.artifacts.values()].every(artifact => artifact.state === "PENDING"), true);
  assert.equal(prepared.f.state.sources[0].project!.stage, "LEAD");
});

test("договор после очистки изображений использует проверенный принятый PDF", async () => {
  const prepared = await prepare(contractWorkflowFixture([source("cp_a", "ESTIMATE")]));
  prepared.f.ports.io.renderPdf = async () => { throw Error("Нельзя рендерить удалённые изображения"); };
  await prepared.workflow.runClaim(prepared.claim);
  assert.equal(prepared.f.state.versions.length, 1); assert.equal(prepared.f.state.sourceVersions.length, 0);
  assert.ok(prepared.f.calls.includes("retained:cp_a"));
  const bad = await prepare(contractWorkflowFixture([source("cp_a", "ESTIMATE")]));
  bad.f.ports.io.retainedPdf = async () => new Uint8Array(Buffer.from("%PDF-wrong"));
  await assert.rejects(bad.workflow.runClaim(bad.claim), /контрольной суммы/);
  assert.equal(bad.f.state.versions.length, 0); assert.deepEqual(bad.f.state.stages, []);
});

test("свежий договор использует исходные screenshots того же рендера, сохраняя байты приложений", async () => {
  const prepared = await prepare();
  const original = prepared.f.ports.io.renderPdf;
  const screenshot = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 99]);
  prepared.f.ports.io.renderPdf = async source => ({ ...(await original(source)), pages: [screenshot] });
  prepared.f.ports.io.rasterizePdf = async () => { throw Error("Свежие страницы нельзя повторно растрировать через PDF"); };
  prepared.f.ports.io.generateDocx = async (_settings, _summary, _profile, sources) => {
    assert.deepEqual(sources[0].images, [screenshot]);
    return new Uint8Array([80, 75, 3, 4]);
  };
  await prepared.workflow.runClaim(prepared.claim);
  assert.equal(prepared.f.state.versions.length, 1);
});

test("некорректная страница приложения не публикует договор и переходы", async () => {
  const prepared = await prepare(), original = prepared.f.ports.io.renderPdf;
  prepared.f.ports.io.renderPdf = async source => ({ ...(await original(source)), pages: [new Uint8Array(7)] });
  await assert.rejects(prepared.workflow.runClaim(prepared.claim), error => error instanceof ContractWorkflowError && error.code === "CONTRACT_APPENDIX_TOO_LARGE");
  assert.equal(prepared.f.state.versions.length, 0); assert.equal(prepared.f.state.sourceVersions.length, 0);
  assert.deepEqual(prepared.f.state.stages, []);
});

test("загруженный файл другого ключа или попытки не становится готовым", async () => {
  const prepared = await prepare();
  prepared.f.ports.io.uploadAndVerify = async artifact => ({ ...artifact, key: artifact.key.replace("-1-", "-2-") });
  await assert.rejects(prepared.workflow.runClaim(prepared.claim), /не совпадает/);
  assert.equal(prepared.f.state.versions.length, 0); assert.equal(prepared.f.state.sourceVersions.length, 0);
});

test("потерянная аренда не разрешает старому исполнителю завершить или испортить новую попытку", async () => {
  const prepared = await prepare();
  prepared.f.ports.io.generateDocx = async () => {
    const job = prepared.f.state.jobs.get(prepared.claim.id)!; job.attempts = 2; job.leaseOwner = "other-worker";
    return new Uint8Array([80, 75, 3, 4]);
  };
  await assert.rejects(prepared.workflow.runClaim(prepared.claim), /Аренда потеряна/);
  assert.equal(prepared.f.state.jobs.get(prepared.claim.id)?.leaseOwner, "other-worker");
  assert.equal(prepared.f.state.jobs.get(prepared.claim.id)?.attempts, 2);
  assert.equal(prepared.f.state.versions.length, 0); assert.deepEqual(prepared.f.state.stages, []);
});
