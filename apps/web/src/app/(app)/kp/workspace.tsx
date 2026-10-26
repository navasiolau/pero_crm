'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import type { ProposalDocument, ProposalListRow } from '@pero/kp-template';
import { Button } from '@/components/ui/button';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { kpSessionRequest, kpSessionDocuments } from '@/lib/kp-session-client';

const stamp = (value: string) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
type PendingCreate = { operationId: string; state: Record<string, unknown> };
export function ProposalsWorkspace({ actorId }: { actorId: string }) {
  const router = useRouter(), pendingCreate = useRef<PendingCreate | null>(null);
  const [rows, setRows] = useState<ProposalListRow[]>([]), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setRows(await kpSessionDocuments()); setError(null); } catch (error) { setError(error instanceof Error ? error.message : 'Не удалось открыть КП'); } }, []);
  useEffect(() => { void load(); }, [load]);
  async function create() {
    setBusy(true); setError(null);
    try {
      const date = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow' }).format(new Date());
      const storageKey = 'pero-crm-kp:' + encodeURIComponent(actorId) + ':pending-create';
      if (!pendingCreate.current) {
        try { const saved: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null'); if (saved && typeof saved === 'object' && 'operationId' in saved && typeof saved.operationId === 'string' && 'state' in saved && saved.state && typeof saved.state === 'object' && !Array.isArray(saved.state)) pendingCreate.current = saved as PendingCreate; } catch { /* Закрытое хранилище не отменяет подтверждение в текущей форме. */ }
      }
      pendingCreate.current ??= { operationId: crypto.randomUUID(), state: { items: [], order: { number: '', date, project: '', validUntil: '' }, client: { name: '', contact: '' }, currency: 'BYN', discount: 0,
        delivery: { visible: false, mode: 'total', total: 0, items: [] } } };
      try { sessionStorage.setItem(storageKey, JSON.stringify(pendingCreate.current)); } catch { /* UUID остаётся в форме. */ }
      const doc = await kpSessionRequest<ProposalDocument>('/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pendingCreate.current) });
      pendingCreate.current = null; try { sessionStorage.removeItem(storageKey); } catch { /* Сервер уже подтвердил результат. */ } router.push('/kp/' + encodeURIComponent(doc.id));
    } catch (error) { setError(error instanceof Error ? error.message : 'Не удалось создать КП'); } finally { setBusy(false); }
  }
  const columns: DataColumn<ProposalListRow>[] = [
    { id: 'number', header: 'КП', sortable: true, sortValue: row => row.number ?? row.project?.number ?? row.name, searchValue: row => row.name + ' ' + (row.number ?? row.project?.number ?? ''), cell: row => row.number ?? row.project?.number ?? row.name },
    { id: 'client', header: 'Клиент', sortValue: row => row.client?.label ?? row.printedClientName ?? '', cell: row => row.client?.label ?? row.printedClientName ?? '—' },
    { id: 'stage', header: 'Проект', cell: row => row.project ? <Link onClick={event => event.stopPropagation()} className="underline underline-offset-4" href={'/projects/' + row.project.id}>Открыть проект</Link> : '—' },
    { id: 'updated', header: 'Обновлено', sortable: true, sortValue: row => row.updatedAt, cell: row => stamp(row.updatedAt) },
  ];
  return <div className="flex min-w-0 flex-col gap-4"><div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-xl font-semibold">КП и договоры</h1><Button disabled={busy} onClick={() => void create()}><Plus className="size-4" />{busy ? 'Создание…' : 'Новое КП'}</Button></div>
    {error ? <p role="alert" className="text-sm text-destructive">{error} <Button variant="link" onClick={() => void load()}>Повторить</Button></p> : null}
    <DataTable rows={rows} columns={columns} searchPlaceholder="Номер, проект или клиент" onRowClick={row => router.push('/kp/' + encodeURIComponent(row.id))}
      renderMobileCard={row => <div className="space-y-1"><b>{(row.number ?? row.project?.number) ? 'КП №' + (row.number ?? row.project?.number) : row.name}</b><p>{row.client?.label ?? row.printedClientName ?? '—'}</p><p className="text-xs text-muted-foreground">{stamp(row.updatedAt)}</p></div>} />
  </div>;
}
