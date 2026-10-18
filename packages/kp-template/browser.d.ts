export function collectProposalPages<T extends { id: string }>(fetchPage: (cursor: string | null) => Promise<{ documents: T[]; nextCursor?: string | null }>): Promise<T[]>;
