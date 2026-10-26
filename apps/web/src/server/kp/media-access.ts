import type { Role } from "@prisma/client";
import { MANAGER_ROLES, hasAnyRole, isValidRolesCombination } from "@/lib/roles";
import { ProposalMediaError } from "./media-contract";

export type MediaOwnerAccess = { proposalId: string; projectId: string | null; revision: number;
  deletedAt: Date | null; stage: string | null; projectDeletedAt: Date | null };

/** Входы получают из свежего DB-read, а не из клиентского JWT или сохранённой роли запроса. */
export function assertProposalMediaAccess(user: { active: boolean; roles: Role[] } | null | undefined,
  owner: MediaOwnerAccess | null | undefined, write: boolean, expectedRevision?: number): asserts owner is MediaOwnerAccess {
  if (!owner || owner.deletedAt || owner.projectId && owner.projectDeletedAt)
    throw new ProposalMediaError("KP_MEDIA_NOT_FOUND");
  if (!user?.active || !isValidRolesCombination(user.roles) || !hasAnyRole(user.roles, MANAGER_ROLES))
    throw new ProposalMediaError("KP_MEDIA_FORBIDDEN");
  if (write && (!owner.projectId || owner.stage !== "LEAD")) throw new ProposalMediaError("KP_MEDIA_LOCKED");
  if (expectedRevision !== undefined && owner.revision !== expectedRevision) throw new ProposalMediaError("KP_MEDIA_REVISION_CONFLICT");
}
