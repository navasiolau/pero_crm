// Transport компактных Server Action DTO: доменные права/auth/CSRF проверяет сервер.
export type FlightActionEnvelope = { a: unknown; f?: unknown };
export type IndependentActionCodec = {
  encodeReference: (reference: object) => Promise<FormData | string>;
  encodeArguments: (args: readonly unknown[]) => Promise<BodyInit>;
  decode: (response: Response) => Promise<FlightActionEnvelope>;
};
export function actionReferenceId(encoded: FormData | string): string {
  if (typeof encoded === "string") throw Error("Не удалось распознать серверное действие");
  const references: { id: string; bound: unknown }[] = [];
  for (const value of encoded.values()) {
    if (typeof value !== "string") continue;
    try {
      const candidate: unknown = JSON.parse(value);
      if (candidate && typeof candidate === "object" && "id" in candidate && typeof candidate.id === "string" && "bound" in candidate && /^[0-9a-f]{40,64}$/i.test(candidate.id)) references.push({ id: candidate.id, bound: candidate.bound });
    } catch { /* Остальные Flight parts не содержат метаданные reference. */ }
  }
  if (references.length !== 1 || references[0].bound !== null) throw Error("Поддерживается только исходное серверное действие поля");
  return references[0].id;
}
export function createIndependentActionTransport({ codec, fetch: fetchRequest, url }: { codec: () => IndependentActionCodec; fetch: typeof fetch; url: () => string }) {
  const ids = new WeakMap<object, Promise<string>>();
  return async function call<A extends unknown[], R>(action: (...args: A) => Promise<R>, args: A): Promise<R> {
    const protocol = codec();
    let id = ids.get(action);
    if (!id) { id = protocol.encodeReference(action).then(actionReferenceId); ids.set(action, id); }
    const actionId = await id;
    const body = await protocol.encodeArguments(args);
    const response = await fetchRequest(url(), { method: "POST", credentials: "same-origin", headers: { Accept: "text/x-component", "Next-Action": actionId }, body });
    if (!response.ok || !response.headers.get("content-type")?.startsWith("text/x-component")) throw Error("Не получен ответ серверного действия");
    if (response.headers.get("x-nextjs-action-not-found") === "1" || response.headers.has("x-action-redirect")) throw Error("Действие или доступ изменились. Откройте карточку заново");
    const revalidated: unknown = JSON.parse(response.headers.get("x-action-revalidated") ?? "[[],0,0]");
    if (!Array.isArray(revalidated) || !Array.isArray(revalidated[0]) || revalidated[0].length || revalidated[1]) throw Error("Поле неожиданно запросило перезагрузку карточки");
    const result = await protocol.decode(response);
    if (result.f !== undefined && result.f !== null && result.f !== "" && !(Array.isArray(result.f) && result.f.length === 0)) throw Error("Серверное действие вернуло полную карточку вместо результата поля");
    return await result.a as R;
  };
}
