'use client';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { saveSignatureSettingsAction } from '@/server/kp/signature-settings-actions';
import type { SignatureSnapshot, SignatureValues } from '@/server/kp/signature-defaults';

type Command = { operationId: string; expectedRevision: number; values: SignatureValues };
export function SignatureDefaultsForm({ initial }: { initial: SignatureSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial), [values, setValues] = useState(initial.values), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [conflict, setConflict] = useState<SignatureSnapshot | null>(null), pending = useRef<Command | null>(null);
  async function save() {
    setBusy(true); setMessage('');
    const command = pending.current ??= { operationId: crypto.randomUUID(), expectedRevision: snapshot.revision, values: structuredClone(values) };
    try {
      const result = await saveSignatureSettingsAction(command);
      if (!result.ok) { setMessage(result.error); if (!result.unknownOutcome) pending.current = null; if (result.current) setConflict(result.current); return; }
      pending.current = null; setSnapshot(result.snapshot); setValues(result.snapshot.values); setConflict(null); setMessage('Сохранено');
    } catch { setMessage('Сохранение не подтверждено. Повторите сохранение'); }
    finally { setBusy(false); }
  }
  const field = (key: keyof SignatureValues, value: string | number) => {
    setMessage(''); setValues(previous => {
      if (key !== 'warrantyMonths' || typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) return { ...previous, [key]: value };
      const tens = value % 100, last = value % 10, unit = tens > 10 && tens < 20 ? 'месяцев' : last === 1 ? 'месяц' : last >= 2 && last <= 4 ? 'месяца' : 'месяцев';
      return { ...previous, warrantyMonths: value, footer: previous.footer.replace(/Гарантия\s*[—–-]\s*\d+\s*месяц(?:а|ев)?\.?/i, `Гарантия — ${value} ${unit}.`) };
    });
  };
  return <form className="space-y-4" onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={busy || !!pending.current || !!conflict} className="space-y-4">
    {([['managerName', 'Менеджер'], ['managerRole', 'Должность'], ['managerPhone', 'Телефон менеджера']] as const).map(([key, label]) => <div className="space-y-1" key={key}><Label htmlFor={'kp-' + key}>{label}</Label><Input id={'kp-' + key} value={values[key]} maxLength={2000} onChange={event => field(key, event.target.value)} /></div>)}
    <div className="space-y-1"><Label htmlFor="kp-warranty">Гарантия, месяцев</Label><Input id="kp-warranty" type="number" min={1} max={1200} step={1} required value={values.warrantyMonths} onChange={event => field('warrantyMonths', Number(event.target.value))} /></div>
    <div className="space-y-1"><Label htmlFor="kp-footer">Подвал / реквизиты</Label><Textarea id="kp-footer" rows={4} maxLength={10000} value={values.footer} onChange={event => field('footer', event.target.value)} /></div>
  </fieldset>{message ? <p role="status" className="break-words text-sm">{message}</p> : null}
    {conflict ? <Button type="button" variant="outline" onClick={() => { setSnapshot(conflict); setValues(conflict.values); setConflict(null); setMessage('Загружены актуальные значения'); }}>Загрузить актуальные значения</Button> : <Button type="submit" disabled={busy}>{busy ? 'Сохранение…' : pending.current ? 'Повторить сохранение' : 'Сохранить'}</Button>}
  </form>;
}
