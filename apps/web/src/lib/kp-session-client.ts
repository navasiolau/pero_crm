import { collectProposalPages } from '@pero/kp-template/browser';
import type { ProposalListRow } from '@pero/kp-template';

export async function kpSessionRequest<T>(path: string, options?: RequestInit): Promise<T> {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('..')) throw Error('Некорректный адрес КП');
  const response = await fetch('/api/kp' + path, { ...options, cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Error(typeof data?.error === 'string' ? data.error : data?.error?.message ?? 'Не удалось выполнить запрос');
  return data as T;
}
export function kpSessionDocuments(): Promise<ProposalListRow[]> {
  return collectProposalPages<ProposalListRow>(cursor => kpSessionRequest('/documents' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '')));
}
