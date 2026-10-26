import type { DomainActor } from "../actor";

export type ContractJson = null | boolean | number | string | ContractJson[] | ContractObject;
export type ContractObject = { [key: string]: ContractJson };
export type ContractActor = { id: string; source: DomainActor["source"]; tokenId?: string; sessionVersion?: number };
export type ContractSourceRef = { proposalId: string; expectedRevision: number };
export type ContractCustomer = ContractObject & { type: string; name: string; signature: string; phone: string; email: string;
  registrationAddress: string; passport: string; taxId: string; registrationId: string; bankDetails: string; representative: string; position: string; authority: string };
export type ContractSettings = ContractObject & { number: string; date: string; city: string; contractorProfileId: string; subject: string;
  deliveryAddress: string; customer: ContractCustomer; proposalIds: string[]; proposalOverrides: ContractObject;
  sameCustomerConfirmed: boolean; productionDays: number | ""; productionUnit: string; installationDays: number | "";
  installationUnit: string; warrantyMonths: number | ""; payments: (ContractObject & { mode: string; value: number | ""; condition: string })[] };
export type ContractClient = { id: string; name: string; lastName: string | null; middleName: string | null; phone: string;
  email: string | null; address: string | null; passportNumber: string | null; passportIssuedBy: string | null; updatedAt: string };
export type ContractSource = { proposalId: string; revision: number; state: ContractObject; clientId: string | null; currency: string;
  deletedAt: string | null; updatedAt: string; acceptedVersionId: string | null; acceptedPdfArtifactId: string | null;
  project: { id: string; stage: string; clientId: string; address: string | null; deletedAt: string | null } | null };
export type ContractRecord = { id: string; primaryProposalId: string; revision: number; settings: ContractObject };
export type ContractModelProposal = { id: string; updatedAt: number; state: ContractObject };
export type ContractModelPort = { normalizeSettings(value: unknown, state: ContractObject, primaryId: string): ContractSettings;
  validate(settings: ContractSettings, proposals: ContractModelProposal[], profiles: ContractObject[]): ContractObject };

export class ContractWorkflowError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); this.name = "ContractWorkflowError"; }
}
export function contractFailure(code: string, message: string, status = 409): never { throw new ContractWorkflowError(code, status, message); }
export const contractClone = <T extends ContractJson>(value: T): T => structuredClone(value);
