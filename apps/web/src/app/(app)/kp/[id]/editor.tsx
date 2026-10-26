'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ProposalClientDetails, ProposalClientOption, ProposalDocument, ProposalFx, ProposalVersion } from '@pero/kp-template';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { kpSessionRequest } from '@/lib/kp-session-client';

type PendingCommand = { resolve: () => void; reject: (error: Error) => void };
const versionLabel = (version: ProposalVersion) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(version.createdAt)) +
  (version.trigger === 'CONTRACT' ? ' · Договор' : version.trigger === 'IMPORT' ? ' · Импорт' : ' · PDF') + (version.isAccepted ? ' · Принято' : '');

export function KpEditor({ documentId }: { documentId: string }) {
  const router = useRouter(), frame = useRef<HTMLIFrameElement>(null), commands = useRef(new Map<string, PendingCommand>());
  const [document, setDocument] = useState<ProposalDocument | null>(null), [liveDocument, setLiveDocument] = useState<ProposalDocument | null>(null);
  const [clients, setClients] = useState<ProposalClientOption[]>([]), [versions, setVersions] = useState<ProposalVersion[]>([]), [versionId, setVersionId] = useState('');
  const [error, setError] = useState<string | null>(null), [pending, setPending] = useState(false), [contractOpen, setContractOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false), [rate, setRate] = useState<ProposalFx | null>(null);
  const send = useCallback((command: Record<string, unknown>): Promise<void> => new Promise((resolve, reject) => {
    if (!frame.current?.contentWindow) { reject(Error('Редактор ещё загружается')); return; }
    const requestId = crypto.randomUUID();
    commands.current.set(requestId, { resolve, reject });
    frame.current.contentWindow.postMessage({ ...command, channel: 'pero-kp', requestId }, window.location.origin);
  }), []);
  const refreshVersions = useCallback(async () => { const data = await kpSessionRequest<{ versions: ProposalVersion[] }>('/documents/' + encodeURIComponent(documentId) + '/versions'); setVersions(data.versions); }, [documentId]);
  useEffect(() => {
    let active = true;
    void Promise.all([kpSessionRequest<{ clients: ProposalClientOption[] }>('/clients'), kpSessionRequest<{ versions: ProposalVersion[] }>('/documents/' + encodeURIComponent(documentId) + '/versions')])
      .then(([clients, versions]) => { if (active) { setClients(clients.clients); setVersions(versions.versions); } }).catch(error => { if (active) setError(error.message); });
    const listener = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow || event.data?.channel !== 'pero-kp') return;
      const message = event.data;
      if (message.type === 'document') {
        setError(null);
        setDocument(message.document); setVersionId(message.versionId ?? ''); if (!message.versionId) setLiveDocument(message.document);
      } else if (message.type === 'rate-preview') setRate(message.fx);
      else if (message.type === 'error') setError(message.message);
      else if (message.type === 'contract-open') setContractOpen(message.open === true);
      else if (message.type === 'versions-changed') { setError(null); router.refresh(); void refreshVersions().catch(error => setError(error.message)); }
      else if (message.type === 'navigate') router.push('/kp/' + encodeURIComponent(message.documentId));
      else if (message.type === 'command-result') {
        const pending = commands.current.get(message.requestId); if (!pending) return;
        commands.current.delete(message.requestId);
        if (message.ok) pending.resolve(); else pending.reject(Error(message.message || 'Не удалось выполнить операцию'));
      }
    };
    window.addEventListener('message', listener);
    const commandMap = commands.current;
    const rejectPending = () => { for (const item of commandMap.values()) item.reject(Error('Редактор закрыт')); commandMap.clear(); };
    window.addEventListener('pagehide', rejectPending);
    return () => { active = false; window.removeEventListener('message', listener); window.removeEventListener('pagehide', rejectPending); rejectPending(); };
  }, [documentId, refreshVersions, router]);
  async function execute(command: Record<string, unknown>) { setPending(true); setError(null); try { await send(command); return true; } catch (error) { setError(error instanceof Error ? error.message : 'Не удалось выполнить операцию'); return false; } finally { setPending(false); } }
  async function selectClient(id: string) {
    const details = await kpSessionRequest<ProposalClientDetails>('/clients/' + encodeURIComponent(id));
    await send({ type: 'client', client: details });
    setClients(previous => previous.some(client => client.id === details.id) ? previous.map(client => client.id === details.id ? details : client) : [...previous, details]);
  }
  async function nbrbRate() {
    if (!rate) return;
    setPending(true); setError(null);
    try { const result = await kpSessionRequest<{ fx: ProposalFx }>('/rates?currency=' + rate.currency + '&date=' + encodeURIComponent(rate.date)); setRate(result.fx); }
    catch (error) { setError(error instanceof Error ? error.message : 'Не удалось получить курс'); } finally { setPending(false); }
  }
  async function openRate() {
    setPending(true); setError(null);
    try { await send({ type: 'rate-preview' }); setRateOpen(true); }
    catch (error) { setError(error instanceof Error ? error.message : 'Не удалось открыть курс КП'); }
    finally { setPending(false); }
  }
  const canEdit = document?.canEdit === true && !versionId;
  const clientOptions = clients.filter(client => client.id !== document?.client?.id).map(client => ({ value: client.id, label: client.label, hint: client.phone ?? undefined }));
  if (document?.client) clientOptions.unshift({ value: document.client.id, label: document.client.label, hint: undefined });
  const activeVersion = versions.find(version => version.id === versionId);
  const busy = pending || contractOpen;
  return <div className="flex min-w-0 flex-1 flex-col gap-3">
    <div className="flex flex-wrap items-end gap-2"><Link href="/kp" className="mr-2 self-center text-sm underline underline-offset-4">КП и договоры</Link>
      <div className="min-w-44 flex-1 space-y-1"><Label htmlFor="kp-client">Клиент CRM</Label><SearchableSelect id="kp-client" options={clientOptions} value={document?.client?.id ?? ''} disabled={!canEdit || busy} onChange={id => { setPending(true); setError(null); void selectClient(id).catch(error => setError(error.message)).finally(() => setPending(false)); }} /></div>
      <Button variant="outline" disabled={!canEdit || busy} onClick={() => void openRate()}>Курс{document?.fx ? ' · ' + document.fx.rate : ''}</Button>
      <div className="min-w-52 flex-1 space-y-1"><Label htmlFor="kp-version">Версия КП · Москва</Label><SearchableSelect id="kp-version" options={[{ value: '', label: 'Текущая редакция' }, ...versions.map(version => ({ value: version.id, label: versionLabel(version) }))]} value={versionId} disabled={busy || !document} onChange={versionId => void execute({ type: 'version', versionId })} /></div>
      {versionId && liveDocument?.canEdit ? <Button variant="outline" disabled={busy} onClick={() => void execute({ type: 'restore' }).then(ok => { if (ok) void refreshVersions().catch(error => setError(error.message)); })}>Восстановить</Button> : null}
      {activeVersion?.pdfArtifactId ? <Button variant="outline" render={<a href={'/api/kp/artifacts/' + encodeURIComponent(activeVersion.pdfArtifactId) + '/download'} download />}>Скачать версию</Button> : null}
      {document?.project ? <Button variant="outline" render={<Link href={'/projects/' + document.project.id} />}>Открыть проект</Button> : null}
      <Button disabled={!document || busy || !!versionId} onClick={() => void execute({ type: 'pdf' })}>Сгенерировать PDF</Button>
      <Button variant="outline" disabled={!document || busy || !!versionId} onClick={() => void execute({ type: 'contract' })}>Сгенерировать договор</Button>
    </div>
    {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
    <iframe key={documentId} ref={frame} src={'/kp/frame?documentId=' + encodeURIComponent(documentId)} title="Редактор коммерческого предложения" className="h-[calc(100dvh-13rem)] min-h-[680px] w-full rounded-lg border bg-white md:h-[calc(100dvh-10rem)]" sandbox="allow-scripts allow-same-origin allow-downloads allow-popups allow-top-navigation-by-user-activation" />
    <Dialog open={rateOpen} onOpenChange={setRateOpen}><DialogContent><DialogHeader><DialogTitle>Курс КП · {rate?.currency}</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground">Курс фиксируется в КП и используется для цен CRM в BYN.</p>
      {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
      <div className="space-y-1"><Label htmlFor="kp-rate">BYN за единицу валюты</Label><Input id="kp-rate" inputMode="decimal" value={rate?.rate ?? ''} onChange={event => setRate(previous => previous ? { ...previous, rate: event.target.value.replace(',', '.'), source: 'MANUAL' } : previous)} /></div>
      <div className="space-y-1"><Label htmlFor="kp-rate-date">Дата курса</Label><Input id="kp-rate-date" type="date" value={rate?.date ?? ''} onChange={event => setRate(previous => previous ? { ...previous, date: event.target.value } : previous)} /></div>
      <DialogFooter><Button variant="outline" disabled={pending} onClick={() => void nbrbRate()}>Получить НБРБ</Button><Button disabled={pending || !rate?.rate.trim()} onClick={() => { if (rate) void execute({ type: 'fx', fx: rate }).then(ok => { if (ok) setRateOpen(false); }); }}>Сохранить курс</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
