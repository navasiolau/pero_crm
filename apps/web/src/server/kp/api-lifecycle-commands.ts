import { withMutationTransaction } from "@/server/transactions/coordinator";
import { apiFailure, type KpApiContext } from "./api-contract";
import { runApiCommand } from "./api-operation";
import { loadApiDocument, documentDto, createApiSaveHooks, mediaDependencies, afterDocumentMutation } from "./api-documents";
import { kpLifecyclePorts, startKpRenderRuntime, kpContractWorkflow } from "./api-render-runtime";
import { readProposalVersionInTransaction, requestProposalPdfInTransaction, restoreProposalVersionInTransaction } from "./lifecycle-store";
import { lifecycleSecurity } from "./api-auth-db";
import { prepareProposalProductMedia } from "./media-core";
import { normalizeProposalState, type ProposalState } from "./proposal-contract";
import { saveProposalInTransaction, type ProposalWriteMutation } from "./proposal-core";
import { fixedProposalRate, proposalCurrency } from "./pricing-contract";
import { proposalArtifactFileName } from "./pdf-filename";

export async function requestApiPdf(context: KpApiContext, input: Record<string, unknown>) {
  const operationId = String(input.operationId), proposalId = String(input.proposalId);
  return runApiCommand({ transaction: withMutationTransaction, context, scope: "kp:export", kind: "pdf", operationId, input,
    mutate: async tx => {
      const result = await requestProposalPdfInTransaction(tx, context.binding, input, kpLifecyclePorts("kp:export"));
      if (result.kind === "retained") return { entityId: proposalId, result: { id: `retained_${result.versionId}`, state: "SUCCEEDED", error: null,
        result: { artifactId: result.artifact.id, versionId: result.versionId, fileName: await proposalArtifactFileName(tx, result.artifact), mimeType: result.artifact.mimeType } } };
      return { entityId: proposalId, result: { id: result.jobId, state: result.state, result: null, error: null }, afterCommit: async () => { startKpRenderRuntime(); } };
    },
  });
}
export async function restoreApiVersion(context: KpApiContext, input: Record<string, unknown>) {
  const proposalId = String(input.proposalId), versionId = String(input.versionId), operationId = String(input.operationId);
  return runApiCommand({ transaction: withMutationTransaction, context, scope: "kp:write", kind: "version.restore", operationId, input,
    prepare: async () => {
      const version = await withMutationTransaction(async tx => {
        await context.authorize("kp:write", tx);
        const current = await loadApiDocument(tx, proposalId);
        if (current.revision !== input.expectedRevision || current.project?.stage !== "LEAD" || current.isArchive) return apiFailure("KP_REVISION_CHANGED", 409, "КП изменено или доступно только для чтения");
        return readProposalVersionInTransaction(tx, context.binding, proposalId, versionId, lifecycleSecurity("kp:write"));
      });
      const state = normalizeProposalState(version.state);
      const prepared = await prepareProposalProductMedia(mediaDependencies(context, "kp:write", { proposalId, operationId }),
        { actorId: context.actor.id, proposalId, expectedRevision: Number(input.expectedRevision), operationId, items: state.items });
      return { prepared };
    },
    mutate: async (tx, ready) => {
      if (!ready) return apiFailure("KP_PREPARATION_REQUIRED", 503, "Версия не подготовлена к восстановлению");
      let mutation: ProposalWriteMutation | undefined;
      const restored = await restoreProposalVersionInTransaction(tx, context.binding, input, kpLifecyclePorts("kp:write"), async (actor, historic) => {
        if (!historic.clientId || !historic.fx.rate || !historic.fx.rateDate || !historic.fx.rateSource) return apiFailure("KP_VERSION_BINDING_UNAVAILABLE", 410, "В версии нет полного снимка клиента или курса");
        const rate = fixedProposalRate({ currency: historic.fx.currency, value: historic.fx.rate, date: historic.fx.rateDate, source: historic.fx.rateSource }, proposalCurrency(historic.fx.currency));
        mutation = await saveProposalInTransaction(tx, actor, { proposalId, expectedRevision: historic.expectedRevision, operationId: historic.operationId,
          clientId: historic.clientId, state: historic.state as ProposalState },
        createApiSaveHooks(rate, ready.prepared));
        return { revision: mutation.result.revision };
      });
      if (!mutation) return apiFailure("KP_OPERATION_REUSED", 409, "Эта операция восстановления уже выполнена в другом канале");
      const confirmed = mutation;
      if (confirmed.result.revision !== restored.revision) return apiFailure("KP_REVISION_CHANGED", 409, "Не совпал результат восстановления");
      return { entityId: proposalId, result: documentDto(await loadApiDocument(tx, proposalId)), afterCommit: () => afterDocumentMutation(context, confirmed) };
    },
  });
}
export async function contractApi(context: KpApiContext, action: "getContract" | "contractHistory" | "saveContract" | "generateContract", input: Record<string, unknown>) {
  const scope = action === "getContract" || action === "contractHistory" ? "kp:contracts:read" : action === "saveContract" ? "kp:contracts:write" : "kp:contracts:generate";
  await context.authorize(scope);
  const workflow = await kpContractWorkflow(scope, context);
  if (action === "getContract") return workflow.form(context.binding, String(input.documentId));
  if (action === "contractHistory") return { versions: await workflow.history(context.binding, String(input.documentId)) };
  if (action === "saveContract") return workflow.saveDraft(context.binding, input);
  const result = await workflow.requestExport(context.binding, input);
  startKpRenderRuntime();
  return result;
}
