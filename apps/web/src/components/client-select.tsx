'use client';
import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { SearchableSelect, type SearchableOption } from '@/components/ui/searchable-select';
import { clientSelectionOptions } from '@/server/clients/actions';

/** Общий выбор из Client для проекта, изделия и КП. Обновление не меняет выбранный ID. */
export function ClientSelect(props: ComponentProps<typeof SearchableSelect>) {
  const [directory, setDirectory] = useState<SearchableOption[] | null>(null), [error, setError] = useState('');
  const generation = useRef(0), mounted = useRef(false);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try { const options = await clientSelectionOptions(); if (mounted.current && request === generation.current) { setDirectory([...options]); setError(''); } }
    catch { if (mounted.current && request === generation.current) setError('Не удалось обновить список клиентов. Откройте список повторно.'); }
  }, []);
  useEffect(() => {
    mounted.current = true; void refresh();
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', visible); document.addEventListener('visibilitychange', visible);
    return () => { mounted.current = false; window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  const options = directory ? [...directory] : [...props.options];
  const selected = props.options.find(option => option.value === props.value);
  if (selected && !options.some(option => option.value === selected.value)) options.unshift(selected);
  return <><SearchableSelect {...props} options={options} onOpenChange={open => { props.onOpenChange?.(open); if (open) void refresh(); }} />{error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}</>;
}
