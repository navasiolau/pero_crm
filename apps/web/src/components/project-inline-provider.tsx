"use client";
import type { ProjectStage } from "@prisma/client";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createInlineSaveController, type InlineSaveController, type InlineValue } from "@/lib/inline-save-controller";
import { projectPatchSchema, type ProjectPatchField, type ProjectPatchDerived } from "@/server/projects/patch-contract";
import { invokeProjectPatch } from "@/lib/independent-project-action";
import { createProjectPricingCache, type ProjectPricingProjection } from "@/lib/project-pricing-cache";
import { parseProjectInlineValue } from "@/lib/project-inline-values";
import { resolvePhoneDependency } from "@/lib/inline-phone-dependency";

export type ProjectInlineInitial = Record<ProjectPatchField, string | null>;
type Context = { controller: (field: ProjectPatchField) => InlineSaveController; flush: () => Promise<boolean>; registerGuard: (key: string, guard: () => Promise<boolean>) => () => void; derived: ProjectPatchDerived; clientId: string; sourceClientId: string; productsSubtotalBYN: string | null; stage: ProjectStage; confirmStage: (stage: ProjectStage) => void; pricingError:string|null };
const InlineContext = createContext<Context | null>(null);
export function ProjectInlineProvider({ projectId, initial, stage, pricingProjection, children }: { projectId: string; initial: ProjectInlineInitial; stage: ProjectStage; pricingProjection: ProjectPricingProjection | null; children: ReactNode }) {
  const [confirmedStage, confirmStage] = useState(stage);
  const guards = useRef(new Map<string, () => Promise<boolean>>());
  const pricing = useRef(createProjectPricingCache(pricingProjection));
  const [subtotal, setSubtotal] = useState(pricingProjection?.productsSubtotalBYN ?? null);
  const [pricingError, setPricingError] = useState<string|null>(null);
  function receivePricing(value:unknown) {
    const result=pricing.current.apply(value);
    if(result.kind==="accepted"){setSubtotal(result.projection.productsSubtotalBYN);setPricingError(null);}
    else if(result.kind==="invalid")setPricingError(result.error);
  }
  const phoneClientId = useRef(String(initial["clientId"]));
  const selectedClient = useRef<{ id: string; phone: string; label?: string }>({ id: String(initial["clientId"]), phone: String(initial["client.phone"]) });
  const [derived, setDerived] = useState<ProjectPatchDerived>({ clientId: String(initial["clientId"]) });
  const controllers = useMemo(() => {
    const result = new Map<ProjectPatchField, InlineSaveController>();
    for (const field of Object.keys(initial) as ProjectPatchField[]) {
      let rebaseClientId: string | undefined;
      let rebaseClientLabel: string | undefined;
      const controller = createInlineSaveController<InlineValue>({ initialValue: ["delivery", "unloading", "installation"].includes(field) && initial[field] !== null ? parseProjectInlineValue(field, String(initial[field])) : initial[field], format: value => value === null ? "" : String(value), parse: raw => parseProjectInlineValue(field, raw), onSaved: () => {
        if (field !== "clientId" && field !== "client.phone") return;
        setTimeout(() => {
          const phone = result.get("client.phone");
          if (phone && ["idle", "saved"].includes(phone.getSnapshot().status)) {
            phoneClientId.current = selectedClient.current.id;
            phone.receive(selectedClient.current.phone);
          }
        }, 0);
      }, onRebase: state => {
        if (field === "client.phone" && rebaseClientId && typeof state.currentValue === "string") {
          phoneClientId.current = rebaseClientId;
          selectedClient.current = { id: rebaseClientId, phone: state.currentValue };
          result.get("clientId")?.receive(rebaseClientId);
          setDerived(previous => ({ ...previous, clientId: rebaseClientId, clientLabel: rebaseClientLabel, phone: state.currentValue as string }));
        }
      }, save: async request => {
        if (field === "client.phone") {
          const dependency = await resolvePhoneDependency(result.get("clientId")!, phoneClientId.current, () => selectedClient.current);
          if (dependency.kind !== "ready") {
            if (dependency.kind === "conflict") { rebaseClientId = dependency.currentClientId; rebaseClientLabel = dependency.currentClientLabel; }
            return { ...dependency, kind: dependency.kind === "blocked" ? "validation" as const : "conflict" as const };
          }
        }
        const input = projectPatchSchema.parse({ projectId, field, ...request, ...(field === "client.phone" ? { expectedClientId: phoneClientId.current } : {}) });
        const reply = await invokeProjectPatch(input);
        if (field === "client.phone" && reply.kind === "conflict") { rebaseClientId = reply.currentClientId; rebaseClientLabel = "currentClientLabel" in reply && typeof reply.currentClientLabel === "string" ? reply.currentClientLabel : undefined; }
        if (reply.kind === "saved" && reply.derived) {
          const projection = reply.derived;
          if (projection.pricingVersion !== undefined || projection.expectedTotalBYN !== undefined) receivePricing(projection);
          if (field === "clientId" && reply.derived.clientId && reply.derived.phone !== undefined) selectedClient.current = { id: reply.derived.clientId, phone: reply.derived.phone, label: reply.derived.clientLabel ?? undefined };
          if (field === "client.phone" && reply.derived.clientId === selectedClient.current.id && reply.derived.phone !== undefined) selectedClient.current = { ...selectedClient.current, phone: reply.derived.phone, label: reply.derived.clientLabel ?? undefined };
          // Поздний ответ телефона прежнего клиента не заменяет новый выбор
          // клиента проекта и не переносит старый телефон на нового клиента.
          const data = field === "client.phone" && reply.derived.clientId !== selectedClient.current.id ? {} : reply.derived;
          setDerived(previous => ({ ...previous, ...data }));
        }
        return reply;
      } });
      result.set(field, controller);
    }
    return result;
    // Сохраняем controllers и черновики проекта при несвязанных server renders.
    // Другой проект получает отдельный keyed provider в карточке.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  // Обычный files/status RSC refresh обновляет только чистые поля; receive()
  // сохраняет pending/dirty/conflict черновики и их настоящие CAS baselines.
  useEffect(() => {
    for (const field of Object.keys(initial) as ProjectPatchField[]) controllers.get(field)!.receive(["delivery", "unloading", "installation"].includes(field) && initial[field] !== null ? parseProjectInlineValue(field, String(initial[field])) : initial[field]);
    const client = controllers.get("clientId")!;
    const phone = controllers.get("client.phone")!;
    if (["idle", "saved"].includes(client.getSnapshot().status) && client.getSnapshot().baseline === initial.clientId) {
      selectedClient.current = { id: String(initial.clientId), phone: String(initial["client.phone"]) };
      if (["idle", "saved"].includes(phone.getSnapshot().status)) phoneClientId.current = String(initial.clientId);
    }
    if(pricingProjection)receivePricing(pricingProjection);
    confirmStage(stage);
  }, [controllers, initial, pricingProjection, stage]);
  const value = useMemo<Context>(() => ({
    controller: field => { const controller = controllers.get(field); if (!controller) throw Error("Неизвестное поле проекта"); return controller; },
    flush: async () => {
      const saved = await Promise.all(["delivery", "unloading", "installation", "clientId", "address", "client.phone", "managerId", "title"].map(field => controllers.get(field as ProjectPatchField)!.flush()));
      if (!saved.every(Boolean)) return false;
      for (const guard of guards.current.values()) if (!await guard()) return false;
      return true;
    },
    registerGuard: (key, guard) => { guards.current.set(key, guard); return () => { if (guards.current.get(key) === guard) guards.current.delete(key); }; },
    derived,
    clientId: derived.clientId ?? String(initial["clientId"]),
    sourceClientId: String(initial["clientId"]),
    productsSubtotalBYN: subtotal,
    stage: confirmedStage, confirmStage, pricingError,
  }), [controllers, derived, initial, subtotal, confirmedStage, pricingError]);
  return <InlineContext.Provider value={value}>{children}</InlineContext.Provider>;
}
export function useProjectInline() { const value = useContext(InlineContext); if (!value) throw Error("ProjectInlineProvider required"); return value; }
export function useOptionalProjectInline() { return useContext(InlineContext); }
