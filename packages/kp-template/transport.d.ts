/** Общие wire-типы UI/session API. Публичный v1 использует Bearer и собственную авторизацию. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type ProposalState = { [key: string]: Json; items: ({ [key: string]: Json; id?: string; qty?: number })[] };
export type ProposalFx = { currency: 'BYN' | 'RUB' | 'USD' | 'EUR'; rate: string; date: string; source: 'NBRB' | 'MANUAL' };
export type ProposalDocument = {
  id: string; revision: number; state: ProposalState; createdAt: string; updatedAt: string;
  project: { id: string; number: string; stage: string } | null;
  client: { id: string; label: string } | null; canEdit: boolean;
  fx: ProposalFx | null;
};
export type ProposalListRow = Pick<ProposalDocument, 'id' | 'revision' | 'project' | 'client' | 'createdAt' | 'updatedAt'> & { name: string; currency: string; number: string | null; printedClientName: string | null };
export type ProposalVersion = { id: string; revision: number; createdAt: string; trigger: 'PDF' | 'CONTRACT' | 'IMPORT'; isAccepted: boolean; pdfArtifactId: string | null };
export type ProposalJob = { id: string; state: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'; error?: string | null;
  result?: { artifactId: string; versionId?: string; fileName: string; mimeType: string; downloadUrl: string } | null };
export type ProposalWrite = { operationId: string; expectedRevision: number; state: ProposalState; clientId?: string; fx?: ProposalFx };
export type ProposalWriteReceipt = ProposalDocument;
export type ProposalVersionDocument = { version: ProposalVersion; document: ProposalDocument };
export type ProposalClientOption = { id: string; label: string; phone?: string | null; address?: string | null };
export type ProposalClientSnapshot = { id: string; name: string; lastName: string | null; middleName: string | null; phone: string; email: string | null;
  address: string | null; comment: string | null; passportNumber: string | null; passportIssuedBy: string | null };
export type ProposalClientDetails = ProposalClientOption & { isTemporary: boolean; snapshot: ProposalClientSnapshot };
export type ProposalSourceRef = { proposalId: string; expectedRevision: number };
export type ProposalContractVersion = { id: string; createdAt: string; docxArtifactId: string; fileName: string };
export type ProposalContractForm = { contractId: string | null; revision: number; settings: { [key: string]: Json }; profiles: { [key: string]: Json }[];
  sourceRefs: ProposalSourceRef[]; clientDefaults: { [key: string]: Json }; clientBaseline: string; canEdit: boolean; versions?: ProposalContractVersion[] };
export type ProposalEditorBootstrap = { documentId: string; actorId: string; apiBase: '/api/kp' };
export type ProposalMediaScope = { kind: 'uploaded' | 'current' } | { kind: 'version'; versionId: string };
export type ProposalMediaAsset = { mediaId: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif' | 'image/gif'; bytesBase64: string };
/** Только вызывающий сервер читает сохранённую ревизию и проверяет принадлежность assets. */
export type SavedProposalRenderInput = { kind: 'pdf'; proposalId: string; revision: number; state: ProposalState; assets: ProposalMediaAsset[]; templateHash: string };
/** Приватный framing: u32BE длины JSON, manifest, затем бинарные assets в заданном порядке. */
export type ProposalPdfStreamManifest = {
  protocol: 1; kind: 'pdf'; proposalId: string; revision: number; state: ProposalState; templateHash: string;
  assets: { mediaId: string; mimeType: ProposalMediaAsset['mimeType']; size: number; sha256: string }[];
};
export type ProposalPdfStreamMetadata = { size: number; sha256: string; pageCount: number; templateHash: string };
export type SavedProposalBundleRenderInput = Omit<SavedProposalRenderInput, 'kind'> & { kind: 'bundle' };
export type RetainedPdfRenderInput = { kind: 'rasterize'; pdfBase64: string };
export type SavedContractRenderInput = { kind: 'docx'; settings: { [key: string]: Json }; summary: { [key: string]: Json }; profile: { [key: string]: Json };
  rendered: { id: string; imagesBase64: string[] }[]; templateHash: string };
export type InternalRenderInput = SavedProposalRenderInput | SavedProposalBundleRenderInput | RetainedPdfRenderInput | SavedContractRenderInput;
export type InternalRenderOutput = { kind: 'pdf'; bytesBase64: string; pageCount: number; templateHash: string } |
  { kind: 'rasterize'; pagesBase64: string[]; pageCount: number; templateHash: string } |
  { kind: 'bundle'; bytesBase64: string; pagesBase64: string[]; pageCount: number; templateHash: string } |
  { kind: 'docx'; bytesBase64: string; pageCount: number; templateHash: string };
