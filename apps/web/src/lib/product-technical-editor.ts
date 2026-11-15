import type { TechnicalSpecifications } from "@pero/kp-template";
import { createInlineSaveController } from "@/lib/inline-save-controller";
import { effectiveProductSpecifications } from "@/lib/product-legacy-specifications";
import type { ProductPatch, ProductPatchResult } from "@/server/products/patch-contract";

export type TechnicalRow = { label: string; value: string };
const emptyRow = { label: "", value: "" };
export const technicalRowDraft = (draft: string): TechnicalRow => JSON.parse(draft) as TechnicalRow;
const serialize = (row: TechnicalRow | null) => row === null ? null : JSON.stringify({ label: row.label, value: row.value });

export function createProductTechnicalEditor({ productId, initial, legacyDescription = null, send, id = () => crypto.randomUUID() }: {
  productId: string; initial: TechnicalSpecifications | null;
  legacyDescription?: string | null;
  send: (patch: ProductPatch) => Promise<ProductPatchResult>; id?: () => string;
}) {
  const listeners = new Set<() => void>();
  const initialEffective = effectiveProductSpecifications(initial, legacyDescription);
  let generation = initialEffective?.sourceGeneration ?? 0;
  let editRevision = initialEffective?.editRevision ?? 0;
  function acknowledge(sourceGeneration: number, revision: number) {
    if (sourceGeneration > generation) { generation = sourceGeneration; editRevision = revision; }
    else if (sourceGeneration === generation) editRevision = Math.max(editRevision, revision);
  }
  const active = new Set<string>();
  const entries = new Map<string, ReturnType<typeof makeEntry>>();
  function makeEntry(key: string, row: TechnicalRow | null, sourceGeneration: number, rawBaseline: string | null | undefined) {
    let sectionId = key;
    let baselineGeneration = sourceGeneration;
    let baselineLegacyDescription = rawBaseline;
    let firstMutation = row === null;
    const controller = createInlineSaveController<string | null>({
      initialValue: serialize(row), format: value => value ?? JSON.stringify(emptyRow),
      isUnchangedDraft: (draft, baseline) => draft === (baseline ?? JSON.stringify(emptyRow)),
      parse: draft => { const pair = technicalRowDraft(draft); return pair.label.trim() === "" && pair.value.trim() === "" ? null : serialize(pair); },
      id: () => { if (firstMutation) { firstMutation = false; return key; } return id(); },
      onSaved: () => prune(key),
      save: async request => {
        const requestGeneration = baselineGeneration;
        const requestLegacyDescription = baselineLegacyDescription;
        if (request.expectedValue === null && request.value !== null) {
          for (const previousKey of snapshot.rows.slice(0, snapshot.rows.indexOf(key))) {
            const previous = entries.get(previousKey)!.controller;
            const state = previous.getSnapshot(), pair = technicalRowDraft(state.draft);
            if (state.baseline === null && (pair.label !== "" || pair.value !== "") && !await previous.flush()) {
              return { kind: "failure" as const, error: "Предыдущая строка ещё не сохранена" };
            }
          }
        }
        const targetId = request.expectedValue === null ? request.clientMutationId : sectionId;
        const reply = await send({ productId, field: "technicalSpecificationRow", sectionId: targetId,
          clientMutationId: request.clientMutationId, expectedSourceGeneration: requestGeneration,
          ...(requestLegacyDescription !== undefined ? { expectedLegacyDescription: requestLegacyDescription } : {}),
          expectedRow: request.expectedValue === null ? null : technicalRowDraft(request.expectedValue),
          row: request.value === null ? null : technicalRowDraft(request.value) });
        if (reply.kind === "saved") {
          sectionId = targetId;
          if (reply.derived?.technicalSpecificationsEditRevision !== undefined) {
            acknowledge(requestGeneration, reply.derived.technicalSpecificationsEditRevision);
          }
          if (reply.derived?.technicalSpecifications) receive(reply.derived.technicalSpecifications);
          if (!reply.noOp || reply.derived?.technicalSpecifications) baselineLegacyDescription = undefined;
          return { kind: "saved" as const, value: serialize(reply.value as TechnicalRow | null) };
        }
        return { kind: reply.kind, error: reply.error };
      },
    });
    return { controller, sectionId: () => sectionId, receive: (pair: TechnicalRow | null, nextGeneration: number, nextRawBaseline: string | null | undefined) => {
      if (!controller.receive(serialize(pair))) return false;
      baselineGeneration = nextGeneration; baselineLegacyDescription = nextRawBaseline; return true;
    } };
  }
  let currentLegacyDescription = initial === null ? legacyDescription : undefined;
  for (const row of initialEffective?.sections ?? []) entries.set(row.id, makeEntry(row.id, row, generation, currentLegacyDescription));
  let trailing = id(); entries.set(trailing, makeEntry(trailing, null, generation, currentLegacyDescription));
  let snapshot = { rows: [...entries.keys()], trailing };
  const serverSnapshot = snapshot;
  function publish(rows = snapshot.rows) { snapshot = { rows, trailing }; listeners.forEach(listener => listener()); }
  function prune(key: string) {
    if (key === trailing || active.has(key)) return;
    const state = entries.get(key)?.controller.getSnapshot();
    if (state?.baseline === null && state.status === "saved" && JSON.stringify(technicalRowDraft(state.draft)) === JSON.stringify(emptyRow)) {
      publish(snapshot.rows.filter(row => row !== key));
    }
  }
  function receive(next: TechnicalSpecifications | null, nextLegacyDescription: string | null = legacyDescription) {
    const effective = effectiveProductSpecifications(next, nextLegacyDescription);
    const nextGeneration = effective?.sourceGeneration ?? 0, nextRevision = effective?.editRevision ?? 0;
    if (nextGeneration < generation || (nextGeneration === generation && nextRevision < editRevision)) return;
    generation = nextGeneration; editRevision = nextRevision;
    currentLegacyDescription = next === null ? nextLegacyDescription : undefined;
    const nextRows: string[] = [];
    for (const pair of effective?.sections ?? []) {
      const existing = [...entries].find(([, entry]) => entry.sectionId() === pair.id);
      const key = existing?.[0] ?? pair.id;
      if (existing) existing[1].receive(pair, generation, currentLegacyDescription);
      else entries.set(key, makeEntry(key, pair, generation, currentLegacyDescription));
      nextRows.push(key);
    }
    for (const key of snapshot.rows) {
      if (key === trailing || nextRows.includes(key)) continue;
      const entry = entries.get(key)!;
      if (!entry.receive(null, generation, currentLegacyDescription)) nextRows.push(key);
    }
    entries.get(trailing)!.receive(null, generation, currentLegacyDescription);
    const rows = [...nextRows, trailing];
    publish(rows);
  }
  return {
    setActive: (key: string, focused: boolean) => { if (focused) active.add(key); else { active.delete(key); prune(key); } },
    getSnapshot: () => snapshot, getServerSnapshot: () => serverSnapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    section: (key: string) => entries.get(key)!.controller,
    setRow: (key: string, pair: TechnicalRow) => {
      entries.get(key)!.controller.setDraft(JSON.stringify(pair));
      if (key === trailing && (pair.label !== "" || pair.value !== "")) {
        trailing = id(); entries.set(trailing, makeEntry(trailing, null, generation, currentLegacyDescription)); publish([...snapshot.rows, trailing]);
      }
    },
    receive,
    flush: async () => (await Promise.all(snapshot.rows.map(key => {
      const controller = entries.get(key)!.controller, state = controller.getSnapshot();
      return ["idle", "saved"].includes(state.status) && state.draft === (state.baseline ?? JSON.stringify(emptyRow)) ? true : controller.flush();
    }))).every(Boolean),
  };
}
