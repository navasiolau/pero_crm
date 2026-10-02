export type InlineValue = string | number | null;
export type InlineReply<V extends InlineValue> = {kind:"saved";value:V} | {kind:"validation"|"conflict"|"forbidden"|"not-found"|"failure";error:string;currentValue?:V;currentClientId?:string;currentClientLabel?:string};
export type InlineRequest<V extends InlineValue> = {value:V;expectedValue:V;clientMutationId:string};
export type InlineState<V extends InlineValue> = {draft:string;baseline:V;status:"idle"|"dirty"|"saving"|"saved"|"error"|"conflict";error:string|null;currentValue?:V;currentClientId?:string;currentClientLabel?:string};
export type InlineOptions<V extends InlineValue> = {initialValue:V;format:(value:V)=>string;parse:(draft:string)=>V;save:(request:InlineRequest<V>)=>Promise<InlineReply<V>>;id?:()=>string;onRebase?:(state:InlineState<V>)=>void;onSaved?:(reply:InlineReply<V>)=>void};
// Очередь принадлежит одному полю; соседние поля сохраняются независимо.
export function createInlineSaveController<V extends InlineValue>(options: InlineOptions<V>) {
  let state: InlineState<V> = { draft: options.format(options.initialValue), baseline: options.initialValue, status: "idle", error: null };
  // Поздняя hydration должна читать тот же снимок, который дал исходный SSR.
  // Клиентские edits/ACK/receive обновляют только live state, не этот объект.
  const serverSnapshot = Object.freeze({ ...state });
  const listeners = new Set<() => void>();
  let generation = 0;
  let inflight: Promise<boolean> | null = null;
  let uncertain: { request: InlineRequest<V>; generation: number } | null = null;
  let queued: { draft: string; generation: number } | null = null;
  let flushRequested = false;
  let disposed = false;
  function publish(next: InlineState<V>) { state = next; if (!disposed) listeners.forEach(listener => listener()); }
  function setDraft(draft: string) {
    if (draft === state.draft) return;
    generation++;
    publish({ ...state, draft, status: uncertain ? "error" : state.status === "conflict" ? "conflict" : "dirty", error: uncertain || state.status === "conflict" ? state.error : null });
  }
  async function drain(retry: boolean): Promise<boolean> {
    if (state.status === "conflict") return false;
    if (uncertain && !retry) return false;
    if (state.status === "error" && !uncertain && !retry) return false;
    for (;;) {
      let attempt = uncertain;
      if (!attempt) {
        const requested = queued ?? { draft: state.draft, generation };
        queued = null;
        let value: V;
        try { value = options.parse(requested.draft); }
        catch (error) { publish({ ...state, status: "error", error: error instanceof Error ? error.message : "Проверьте значение" }); return false; }
        if (Object.is(value, state.baseline)) {
          const newer = requested.generation !== generation;
          publish({ ...state, draft: newer ? state.draft : options.format(value), status: newer ? "dirty" : "saved", error: null });
          if (queued || (flushRequested && newer)) continue;
          return true;
        }
        attempt = { request: { value, expectedValue: state.baseline, clientMutationId: (options.id ?? (() => crypto.randomUUID()))() }, generation: requested.generation };
      }
      publish({ ...state, status: "saving", error: null });
      let result: InlineReply<V>;
      try { result = await options.save(attempt.request); }
      catch { uncertain = attempt; publish({ ...state, status: "error", error: "Ответ не получен. Повторите сохранение: запрос останется тем же." }); return false; }
      if (result.kind !== "saved") {
        uncertain = null;
        publish({ ...state, status: result.kind === "conflict" ? "conflict" : "error", error: result.error, currentValue: result.currentValue, currentClientId: result.currentClientId, currentClientLabel: result.currentClientLabel });
        return false;
      }
      uncertain = null;
      const newer = generation !== attempt.generation;
      publish({ draft: newer ? state.draft : options.format(result.value), baseline: result.value, status: newer ? "dirty" : "saved", error: null });
      options.onSaved?.(result);
      if (!queued && !(flushRequested && newer)) return true;
    }
  }
  function start(retry = false, flush = false): Promise<boolean> {
    queued = { draft: state.draft, generation };
    flushRequested ||= flush;
    if (inflight) return inflight;
    const promise = drain(retry);
    inflight = promise;
    void promise.finally(() => { if (inflight === promise) { inflight = null; flushRequested = false; queued = null; } });
    return promise;
  }
  return {
    getSnapshot: () => state,
    getServerSnapshot: () => serverSnapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setDraft,
    commit: () => start(),
    flush: () => start(false, true),
    retry: () => start(true),
    acceptCurrent: () => {
      if (state.status !== "conflict" || state.currentValue === undefined) return;
      options.onRebase?.(state);
      generation++; publish({ draft: options.format(state.currentValue), baseline: state.currentValue, status: "idle", error: null });
    },
    rebaseAndRetry: () => {
      if (state.status !== "conflict" || state.currentValue === undefined) return Promise.resolve(false);
      options.onRebase?.(state);
      publish({ ...state, baseline: state.currentValue, status: "dirty", error: null, currentValue: undefined });
      return start(true);
    },
    receive: (value: V) => {
      if (inflight || uncertain || !["idle", "saved"].includes(state.status)) return;
      if (!Object.is(value, state.baseline)) publish({ draft: options.format(value), baseline: value, status: "idle", error: null });
    },
    dispose: () => { disposed = true; listeners.clear(); },
  };
}
export type InlineSaveController<V extends InlineValue = InlineValue> = ReturnType<typeof createInlineSaveController<V>>;
