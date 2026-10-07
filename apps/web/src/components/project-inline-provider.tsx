"use client";
import type { ProjectStage } from "@prisma/client";
import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createInlineSaveController, type InlineSaveController, type InlineValue } from "@/lib/inline-save-controller";
import { projectPatchSchema, type ProjectPatchField, type ProjectPatchDerived } from "@/server/projects/patch-contract";
import { invokeProjectPatch } from "@/lib/independent-project-action";
import { createProjectPricingCache, type ProjectPricingProjection } from "@/lib/project-pricing-cache";
import { parseProjectInlineValue } from "@/lib/project-inline-values";
import {createProjectContactControllers,type ProjectContactInitial} from '@/lib/project-contact-controllers';


type ActiveProjectField = Exclude<ProjectPatchField, "address">;
type IndependentProjectField = Exclude<ActiveProjectField,'clientId'|'client.phone'|'client.address'>;
const activeProjectFields: IndependentProjectField[] = ["title", "managerId", "delivery", "unloading", "installation"];
export type ProjectInlineInitial = Record<IndependentProjectField, string | null>&ProjectContactInitial;
type Context = { controller: (field: ActiveProjectField) => InlineSaveController; flush: () => Promise<boolean>; registerGuard: (key: string, guard: () => Promise<boolean>) => () => void; derived: ProjectPatchDerived; clientId: string; sourceClientId: string; productsSubtotalBYN: string | null; stage: ProjectStage; confirmStage: (stage: ProjectStage) => void; pricingError:string|null; switchingClient:boolean };
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
  const [derived, setDerived] = useState<ProjectPatchDerived>({ clientId: String(initial["clientId"]) });
  const controllers = useMemo(() => {
    const result = new Map<IndependentProjectField, InlineSaveController>();
    const save=async(input:Parameters<typeof invokeProjectPatch>[0])=>{
      const reply=await invokeProjectPatch(input);
      if(reply.kind==='saved'&&reply.derived){
        if(reply.derived.pricingVersion!==undefined||reply.derived.expectedTotalBYN!==undefined)receivePricing(reply.derived);
        setDerived(previous=>({...previous,...reply.derived}));
      }
      return reply;
    };
    const contacts=createProjectContactControllers(projectId,initial,save);
    for (const field of activeProjectFields) {
      const controller = createInlineSaveController<InlineValue>({ initialValue: ["delivery", "unloading", "installation"].includes(field) && initial[field] !== null ? parseProjectInlineValue(field, String(initial[field])) : initial[field], format: value => value === null ? "" : String(value), parse: raw => parseProjectInlineValue(field, raw), save: async request => {
        const input = projectPatchSchema.parse({ projectId, field, ...request });
        return save(input);
      } });
      result.set(field, controller);
    }
    return {fields:result,contacts};
    // Сохраняем controllers и черновики проекта при несвязанных server renders.
    // Другой проект получает отдельный keyed provider в карточке.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  const contacts=useSyncExternalStore(controllers.contacts.subscribe,controllers.contacts.getSnapshot,controllers.contacts.getServerSnapshot);
  // Обычный files/status RSC refresh обновляет только чистые поля; receive()
  // сохраняет pending/dirty/conflict черновики и их настоящие CAS baselines.
  useEffect(() => {
    for (const field of activeProjectFields) controllers.fields.get(field)!.receive(["delivery", "unloading", "installation"].includes(field) && initial[field] !== null ? parseProjectInlineValue(field, String(initial[field])) : initial[field]);
    controllers.contacts.receive(initial);
    if(pricingProjection)receivePricing(pricingProjection);
    confirmStage(stage);
  }, [controllers, initial, pricingProjection, stage]);
  const value = useMemo<Context>(() => ({
    controller: field => {if(field==='clientId'||field==='client.phone'||field==='client.address')return controllers.contacts.controller(field);const controller = controllers.fields.get(field); if (!controller) throw Error("Неизвестное поле проекта"); return controller; },
    flush: async () => {
      const saved = await Promise.all([controllers.contacts.flush(),...activeProjectFields.map(field=>controllers.fields.get(field)!.flush())]);
      if (!saved.every(Boolean)) return false;
      for (const guard of guards.current.values()) if (!await guard()) return false;
      return true;
    },
    registerGuard: (key, guard) => { guards.current.set(key, guard); return () => { if (guards.current.get(key) === guard) guards.current.delete(key); }; },
    derived,
    clientId:contacts.clientId,
    sourceClientId:contacts.clientId,
    switchingClient:contacts.switching,
    productsSubtotalBYN: subtotal,
    stage: confirmedStage, confirmStage, pricingError,
  }), [controllers, contacts, derived, subtotal, confirmedStage, pricingError]);
  return <InlineContext.Provider value={value}>{children}</InlineContext.Provider>;
}
export function useProjectInline() { const value = useContext(InlineContext); if (!value) throw Error("ProjectInlineProvider required"); return value; }
export function useOptionalProjectInline() { return useContext(InlineContext); }
