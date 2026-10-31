import { apiFailure, KpApiError, type KpApiService } from "./api-contract";
import { ProposalWriteError } from "./proposal-contract";
import { ProposalMediaError } from "./media-contract";
import { ProposalLifecycleError } from "./lifecycle-contract";
import { ContractWorkflowError } from "./contract-types";
import { prisma } from "@/lib/prisma";
import { changeApiClient } from "./api-client-binding";
import { listApiDocuments, loadApiDocument, documentDto, saveApiDocument, uploadApiMedia, readApiMedia, listApiClients, clientApiDetails, createApiClient } from "./api-documents";
import { getApiOperation, listApiVersions, getApiVersion, getApiJob, readApiArtifact } from "./api-resources";
import { requestApiPdf, restoreApiVersion, contractApi } from "./api-lifecycle-commands";
import { fetchKpNbrbRate, rateDto } from "./api-rates";

export const kpApiService: KpApiService = {
  async execute(action, context, input) {
    try {
      switch (action) {
        case "listDocuments": return await listApiDocuments(context, input);
        case "getDocument": await context.authorize("kp:read"); return documentDto(await loadApiDocument(prisma, String(input.proposalId)));
        case "createDocument": return await saveApiDocument(context, input, true);
        case "saveDocument": return await saveApiDocument(context, input, false);
        case "changeClient": return await changeApiClient(context, input);
        case "readOperation": return await getApiOperation(context, String(input.operationId));
        case "upload": return await uploadApiMedia(context, input);
        case "readMedia": return await readApiMedia(context, input);
        case "listVersions": return await listApiVersions(context, String(input.proposalId));
        case "getVersion": return await getApiVersion(context, String(input.proposalId), String(input.versionId));
        case "restoreVersion": return await restoreApiVersion(context, input);
        case "pdf": return await requestApiPdf(context, input);
        case "getContract": case "contractHistory": case "saveContract": case "generateContract": return await contractApi(context, action, input);
        case "getJob": return await getApiJob(context, String(input.jobId));
        case "readArtifact": return await readApiArtifact(context, String(input.artifactId));
        case "listClients": return await listApiClients(context, input);
        case "getClient": return await clientApiDetails(context, String(input.clientId));
        case "createClient": return await createApiClient(context, input);
        case "rates": return { fx: rateDto(await fetchKpNbrbRate(context, input)) };
      }
      const unsupported: never = action; void unsupported;
      return apiFailure("KP_NOT_FOUND", 404, "Операция КП не поддерживается");
    } catch (error) {
      if (error instanceof KpApiError) throw error;
      if (error instanceof ProposalWriteError) {
        const status = { validation: 400, forbidden: 403, "not-found": 404, conflict: 409, locked: 409, failure: 503 }[error.kind];
        throw new KpApiError(`KP_${error.kind.toUpperCase().replace(/-/g, "_")}`, status, error.message);
      }
      if (error instanceof ProposalMediaError) {
        const status: Record<string, number> = { KP_MEDIA_TOO_LARGE: 413, KP_MEDIA_FORBIDDEN: 403, KP_MEDIA_NOT_FOUND: 404, KP_MEDIA_EXPIRED: 410,
          KP_MEDIA_BUSY: 503, KP_MEDIA_STORAGE_CHANGED: 503, KP_MEDIA_STORAGE_FAILED: 503, KP_MEDIA_CHECKSUM_MISMATCH: 502,
          KP_MEDIA_LOCKED: 409, KP_MEDIA_REVISION_CONFLICT: 409, KP_MEDIA_OPERATION_CONFLICT: 409, KP_MEDIA_LEASE_LOST: 409, KP_MEDIA_COPY_REQUIRED: 409 };
        throw new KpApiError(error.code, status[error.code] ?? 400, error.message);
      }
      if (error instanceof ProposalLifecycleError || error instanceof ContractWorkflowError) throw new KpApiError(error.code, error.status, error.message);
      throw error;
    }
  },
};
