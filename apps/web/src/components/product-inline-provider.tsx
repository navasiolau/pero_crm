"use client";
import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { createInlineSaveController, type InlineSaveController, type InlineValue } from "@/lib/inline-save-controller";
import { productPatchSchema, type ProductPatchField, type ProductPatchDerived } from "@/server/products/patch-contract";
import { invokeProductPatch } from "@/lib/independent-product-action";
import { normalizeProductDescription } from "@/lib/product-description";
import { isUnchangedProductDescriptionDraft } from "@/lib/product-description-draft";
import { resolvePhoneDependency } from "@/lib/inline-phone-dependency";

export type ProductInlineInitial = Record<ProductPatchField, InlineValue>;
type Context = { controller: (field: ProductPatchField) => InlineSaveController; flush: () => Promise<boolean>; registerGuard: (key: string, guard: () => Promise<boolean>) => () => void; derived: ProductPatchDerived; clientId: string; sourceClientId: string };
const InlineContext = createContext<Context | null>(null);
function parse(field: ProductPatchField, raw: string): InlineValue {
  if (field === "description") return normalizeProductDescription(raw);
  const value = raw.trim();
  if (field === "quantity") { const quantity = Number(value); if (!value || !Number.isInteger(quantity) || quantity < 1 || quantity > 2_147_483_647) throw Error("Количество — целое число от 1 до 2147483647"); return quantity; }
  if (field === "expectedPrice") { if (!value) return null; const decimal = value.replace(",", "."); if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(decimal)) throw Error("Введите неотрицательную цену с точностью до копеек"); const [units, fraction = ""] = decimal.split("."); return `${BigInt(units)}.${fraction.padEnd(2, "0")}`; }
  if (["title", "client.phone", "project.clientId"].includes(field)) { if (!value) throw Error(field === "client.phone" ? "Укажите телефон клиента" : "Заполните обязательное поле"); return value; }
  return value || null;
}
export function ProductInlineProvider({ productId, initial, children }: { productId: string; initial: ProductInlineInitial; children: ReactNode }) {
  const guards = useRef(new Map<string, () => Promise<boolean>>());
  const phoneClientId = useRef(String(initial["project.clientId"]));
  const selectedClient = useRef<{ id: string; phone: string; label?: string }>({ id: String(initial["project.clientId"]), phone: String(initial["client.phone"]) });
  const [derived, setDerived] = useState<ProductPatchDerived>({ clientId: String(initial["project.clientId"]) });
  const controllers = useMemo(() => {
    const result = new Map<ProductPatchField, InlineSaveController>();
    for (const field of Object.keys(initial) as ProductPatchField[]) {
      let rebaseClientId: string | undefined;
      let rebaseClientLabel: string | undefined;
      const controller = createInlineSaveController<InlineValue>({ initialValue: field === "expectedPrice" && initial[field] !== null ? parse(field, String(initial[field])) : initial[field], format: value => value === null ? "" : String(value), parse: raw => parse(field, raw), isUnchangedDraft: field === "description" ? (draft, baseline) => isUnchangedProductDescriptionDraft(draft, baseline === null ? null : String(baseline)) : undefined, onSaved: () => {
        if (field !== "project.clientId" && field !== "client.phone") return;
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
          result.get("project.clientId")?.receive(rebaseClientId);
          setDerived(previous => ({ ...previous, clientId: rebaseClientId, clientLabel: rebaseClientLabel, phone: state.currentValue as string }));
        }
      }, save: async request => {
        if (field === "client.phone") {
          const dependency = await resolvePhoneDependency(result.get("project.clientId")!, phoneClientId.current, () => selectedClient.current);
          if (dependency.kind !== "ready") {
            if (dependency.kind === "conflict") { rebaseClientId = dependency.currentClientId; rebaseClientLabel = dependency.currentClientLabel; }
            return { ...dependency, kind: dependency.kind === "blocked" ? "validation" as const : "conflict" as const };
          }
        }
        const input = productPatchSchema.parse({ productId, field, ...request, ...(field === "client.phone" ? { expectedClientId: phoneClientId.current } : {}) });
        const reply = await invokeProductPatch(input);
        if (field === "client.phone" && reply.kind === "conflict") { rebaseClientId = reply.currentClientId; rebaseClientLabel = "currentClientLabel" in reply && typeof reply.currentClientLabel === "string" ? reply.currentClientLabel : undefined; }
        if (reply.kind === "saved" && reply.derived) {
          if (field === "project.clientId" && reply.derived.clientId && reply.derived.phone !== undefined) selectedClient.current = { id: reply.derived.clientId, phone: reply.derived.phone, label: reply.derived.clientLabel ?? undefined };
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
    // Сохраняем controllers и черновики изделия при несвязанных server renders.
    // Другое изделие получает отдельный keyed provider в карточке.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);
  const value = useMemo<Context>(() => ({
    controller: field => { const controller = controllers.get(field); if (!controller) throw Error("Неизвестное поле изделия"); return controller; },
    flush: async () => {
      const saved = await Promise.all(["expectedPrice", "quantity", "engineerId"].map(field => controllers.get(field as ProductPatchField)!.flush()));
      if (!saved.every(Boolean)) return false;
      for (const guard of guards.current.values()) if (!await guard()) return false;
      return true;
    },
    registerGuard: (key, guard) => { guards.current.set(key, guard); return () => { if (guards.current.get(key) === guard) guards.current.delete(key); }; },
    derived,
    clientId: derived.clientId ?? String(initial["project.clientId"]),
    sourceClientId: String(initial["project.clientId"]),
  }), [controllers, derived, initial]);
  return <InlineContext.Provider value={value}>{children}</InlineContext.Provider>;
}
export function useProductInline() { const value = useContext(InlineContext); if (!value) throw Error("ProductInlineProvider required"); return value; }
export function useOptionalProductInline() { return useContext(InlineContext); }
