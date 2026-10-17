"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createRequestId } from "@/lib/request-id";
import { paymentSchema, type PaymentInput, type PaymentMutationResult } from "@/server/payments/contracts";
import { stockPurchaseSchema, type StockPurchaseInput } from "@/server/warehouse/contracts";
import { addPayment, getPaymentActorId } from "@/server/payments/actions";
import { addPaidStockReceipt } from "@/server/warehouse/stock-purchase-actions";

export type PaymentCommand = {kind: "payment"; data: PaymentInput} | {kind: "stock"; data: StockPurchaseInput};
type Ack = PaymentMutationResult | Awaited<ReturnType<typeof addPaidStockReceipt>>;
type Scope = {kind: PaymentCommand["kind"]; direction: "INCOME" | "EXPENSE"; projectId?: string | null};
type Intent = {command: PaymentCommand; uncertain: boolean};
type Blocked = {blocked: true; error: string};
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const scopeKey = (scope: Scope) => JSON.stringify([scope.kind, scope.direction, scope.projectId ?? null]);
const parseCommand = (value: unknown): PaymentCommand => {
  if (!value || typeof value !== "object" || !("kind" in value) || !("data" in value)) throw Error("INVALID_SAVED_PAYMENT");
  if (value.kind === "payment") return {kind: "payment", data: paymentSchema.parse(value.data)};
  if (value.kind === "stock") return {kind: "stock", data: stockPurchaseSchema.parse(value.data)};
  throw Error("INVALID_SAVED_PAYMENT");
};
const content = (command: PaymentCommand) => JSON.stringify({...command, data: {...command.data, clientMutationId: undefined}});

/** Один actor-scoped UUID живёт до подтверждения; browser reload только читает sessionStorage. */
export function createPaymentCommands(send: (command: PaymentCommand, actorId: string) => Promise<Ack>, storage: StoragePort,
  requestId: () => string = createRequestId) {
  let actorId = "", generation = 0;
  const intents = new Map<string, Intent | Blocked>(), flights = new Map<string, Promise<Ack | null>>();
  const key = (actor: string, scope: Scope) => "pero:payment-intent:" + JSON.stringify([actor, scopeKey(scope)]);
  function observeActor(next: string) {if (next !== actorId) {actorId = next; generation++;}}
  function peek(actor: string, scope: Scope): Intent | Blocked | undefined {
    if (!actor || actor !== actorId) return;
    const id = key(actor, scope); if (intents.has(id)) return intents.get(id);
    try {
      const raw = storage.getItem(id); if (!raw) return;
      const saved: unknown = JSON.parse(raw);
      if (!saved || typeof saved !== "object" || !("version" in saved) || saved.version !== 1 || !("actorId" in saved) || saved.actorId !== actor ||
        !("scope" in saved) || saved.scope !== scopeKey(scope) || !("command" in saved) || Object.keys(saved).sort().join() !== "actorId,command,scope,version") throw Error("INVALID_SAVED_PAYMENT");
      const command = parseCommand(saved.command);
      if (command.kind !== scope.kind || command.kind === "payment" && command.data.direction !== scope.direction) throw Error("INVALID_SAVED_PAYMENT");
      if (command.kind === "payment" && scope.projectId != null && command.data.projectId !== scope.projectId) throw Error("INVALID_SAVED_PAYMENT");
      Object.freeze(command.data); Object.freeze(command);
      const intent = {command, uncertain: true}; intents.set(id, intent); return intent;
    } catch {const blocked: Blocked = {blocked: true, error: "Не удалось прочитать прежнее намерение. Проверьте историю платежей."}; intents.set(id, blocked); return blocked;}
  }
  function settle(id: string, intent: Intent) {
    try {storage.removeItem(id); intents.delete(id);} catch {intent.uncertain = true;}
  }
  async function run(actor: string, scope: Scope, input: PaymentCommand): Promise<Ack | null> {
    if (!actor || actor !== actorId) return null;
    const id = key(actor, scope), saved = peek(actor, scope);
    if (saved && "blocked" in saved) return {ok: false, outcome: "UNKNOWN", retrySafe: false, error: saved.error};
    const unknown = (intent: Intent, error: string): PaymentMutationResult => ({ok: false, outcome: "UNKNOWN", retrySafe: true, clientMutationId: intent.command.data.clientMutationId, error});
    if (saved && content(saved.command) !== content(parseCommand(input))) return unknown(saved, "Сначала подтвердите прежний платёж");
    const running = flights.get(id); if (running) return running;
    let intent: Intent;
    try {intent = saved ?? {command: parseCommand({...input, data: {...input.data, clientMutationId: requestId().toLowerCase()}}), uncertain: false};}
    catch {return {ok: false, outcome: "ROLLED_BACK", kind: "invalid-request", error: "Проверьте данные платежа"};}
    Object.freeze(intent.command.data); Object.freeze(intent.command); intents.set(id, intent);
    try {storage.setItem(id, JSON.stringify({version: 1, actorId: actor, scope: scopeKey(scope), command: intent.command}));}
    catch {if (!saved) intents.delete(id); return unknown(intent, "Не удалось сохранить идентификатор. Платёж не отправлен.");}
    const epoch = generation;
    const execution = (async (): Promise<Ack | null> => {
      let result: Ack;
      try {result = await send(intent.command, actor);} catch {result = unknown(intent, "Ответ не получен. Проверьте прежний запрос.");}
      if (generation !== epoch || actorId !== actor) {intent.uncertain = true; return null;}
      if (result.clientMutationId !== intent.command.data.clientMutationId || result.ok && !result.resultId) result = unknown(intent, "Подтверждение не совпало с запросом");
      const removed = !result.ok && "removedPaymentId" in result && result.kind === "removed" && !!result.removedPaymentId;
      if (result.ok || removed) settle(id, intent);
      else if (result.outcome === "ROLLED_BACK" && !intent.uncertain && result.kind !== "conflict") settle(id, intent);
      else {intent.uncertain = true; result = {...result, outcome: "UNKNOWN", retrySafe: true};}
      return result;
    })();
    flights.set(id, execution); try {return await execution;} finally {if (flights.get(id) === execution) flights.delete(id);}
  }
  return {observeActor, peek, run};
}
let browserCommands: ReturnType<typeof createPaymentCommands> | undefined;
const send = (command: PaymentCommand, actorId: string) => command.kind === "payment" ? addPayment(command.data, actorId) : addPaidStockReceipt(command.data, actorId);
const browserStorage: StoragePort = {getItem: key => window.sessionStorage.getItem(key), setItem: (key, value) => window.sessionStorage.setItem(key, value), removeItem: key => window.sessionStorage.removeItem(key)};
export function usePaymentCreateCommand(open: boolean, scope: Scope) {
  const router = useRouter(), [identity, setIdentity] = useState<{actorId: string; loading: boolean; error: string; restored?: PaymentCommand; session?: object}>({actorId: "", loading: true, error: ""}), [, redraw] = useState(0);
  const commands = typeof window === "undefined" ? createPaymentCommands(send, {getItem: () => null, setItem: () => {}, removeItem: () => {}})
    : browserCommands ??= createPaymentCommands(send, browserStorage);
  const {kind, direction, projectId} = scope;
  const session = useMemo(() => ({ open, kind, direction, projectId }), [open, kind, direction, projectId]);
  const loading = identity.loading || identity.session !== session;
  useEffect(() => {
    if (!open) return;
    let cancelled = false; setIdentity(current => ({...current, loading: true, error: ""}));
    getPaymentActorId().then(result => {
      if (cancelled) return;
      if (result.ok) {
        commands.observeActor(result.actorId); const saved = commands.peek(result.actorId, {kind, direction, projectId});
        setIdentity({actorId: result.actorId, loading: false, error: "", session, restored: saved && !("blocked" in saved) ? saved.command : undefined});
      }
      else setIdentity({actorId: "", loading: false, error: result.error, session});
    }).catch(() => {if (!cancelled) setIdentity({actorId: "", loading: false, error: "Не удалось подтвердить учётную запись", session});});
    return () => {cancelled = true;};
  }, [open, kind, direction, projectId, commands, session]);
  const intent = identity.actorId && !loading ? commands.peek(identity.actorId, scope) : undefined;
  async function run(command: PaymentCommand) {
    const result = await commands.run(identity.actorId, scope, command); redraw(value => value + 1);
    if (result && !result.ok && "kind" in result && result.kind === "actor-changed") router.refresh();
    return result;
  }
  return {...identity, loading, session, intent, run};
}
