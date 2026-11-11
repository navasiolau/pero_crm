import type { FurnitureSection, TechnicalSpecifications } from "@pero/kp-template";
import { createInlineSaveController, type InlineSaveController, type InlineValue } from "@/lib/inline-save-controller";
import { flushSketchCriticalFields } from "@/lib/product-sketch-ui";
import type { ProductPatch, ProductPatchResult } from "@/server/products/patch-contract";

const sourcesToEdit = ["description", "size", "note"] as const;
type Source = typeof sourcesToEdit[number];
type StructuralField = "technicalSpecificationAdd" | "technicalSpecificationRemove";
type StructuralPatch = Extract<ProductPatch, { field: StructuralField }>;
type StructureChange = { section: FurnitureSection; expectedSourceGeneration: number };
type StructureState = {
  structured: boolean;
  sections: FurnitureSection[];
  pending: boolean;
  lockedLegacy: boolean;
  lockedSectionId: string | null;
  issue: { error: string; retryable: boolean } | null;
};

export function createProductTechnicalEditor({
  productId, initial, send, flushLegacy, id = () => crypto.randomUUID(),
}: {
  productId: string;
  initial: TechnicalSpecifications | null;
  send: (patch: ProductPatch) => Promise<ProductPatchResult>;
  flushLegacy: () => Promise<boolean>;
  id?: () => string;
}) {
  const serverSnapshot: StructureState = {
    structured: initial !== null, sections: initial?.sections ?? [], pending: false,
    lockedLegacy: false, lockedSectionId: null, issue: null,
  };
  let state = serverSnapshot;
  let sourceGeneration = initial?.sourceGeneration ?? 0;
  let request: StructuralPatch | null = null;
  let inflight: Promise<boolean> | null = null;
  const listeners = new Set<() => void>();
  const sections = new Map<string, InlineSaveController>();
  const sources = new Map<Source, InlineSaveController>();
  const generations = new WeakMap<InlineSaveController, number>();

  function publish(update: Partial<StructureState>) {
    state = { ...state, ...update };
    listeners.forEach(listener => listener());
  }

  function receiveField(controller: InlineSaveController, value: InlineValue, generation: number) {
    if (!controller.receive(value)) return false;
    generations.set(controller, generation);
    return true;
  }

  function addSectionController(section: FurnitureSection, generation: number) {
    function updateConfirmedValue(value: InlineValue) {
      const current = state.sections.find(row => row.id === section.id);
      if (!current || current.value === value) return;
      publish({ sections: state.sections.map(row => row.id === section.id ? { ...row, value: String(value ?? "") } : row) });
    }
    const controller: InlineSaveController = createInlineSaveController<InlineValue>({
      initialValue: section.value,
      format: value => String(value ?? ""),
      parse: value => value,
      id,
      onSaved: reply => { if (reply.kind === "saved") updateConfirmedValue(reply.value); },
      onRebase: snapshot => { if (snapshot.currentValue !== undefined) updateConfirmedValue(snapshot.currentValue); },
      save: ({ clientMutationId, expectedValue, value }) => send({
        productId, clientMutationId, field: "technicalSpecificationValue", sectionId: section.id,
        expectedSourceGeneration: generations.get(controller)!,
        expectedValue: String(expectedValue ?? ""), value: String(value ?? ""),
      }),
    });
    generations.set(controller, generation);
    sections.set(section.id, controller);
    return controller;
  }

  for (const section of state.sections) addSectionController(section, sourceGeneration);
  for (const source of sourcesToEdit) {
    const controller: InlineSaveController = createInlineSaveController<InlineValue>({
      initialValue: initial?.[source] ?? null,
      format: value => String(value ?? ""),
      parse: value => value.trim() ? value : null,
      isUnchangedDraft: (draft, baseline) => draft === String(baseline ?? ""),
      id,
      save: ({ clientMutationId, expectedValue, value }) => send({
        productId, clientMutationId, field: "technicalSpecificationSource", source,
        expectedSourceGeneration: generations.get(controller)!,
        expectedValue: expectedValue === null ? null : String(expectedValue),
        value: value === null ? null : String(value),
      }),
    });
    generations.set(controller, sourceGeneration);
    sources.set(source, controller);
  }

  function receive(next: TechnicalSpecifications | null) {
    if (inflight || state.pending || state.issue) return;
    if (!next) {
      const clean = [...sections.values(), ...sources.values()]
        .every(controller => controller.receive(controller.getSnapshot().baseline));
      if (!state.structured || !clean) return;
      sections.clear();
      sourceGeneration = 0;
      for (const controller of sources.values()) receiveField(controller, null, sourceGeneration);
      publish({ structured: false, sections: [] });
      return;
    }
    sourceGeneration = next.sourceGeneration;
    const updated = next.sections.map(section => {
      const existing = sections.get(section.id);
      if (!existing) addSectionController(section, sourceGeneration);
      if (existing && !receiveField(existing, section.value, sourceGeneration)) return state.sections.find(row => row.id === section.id) ?? section;
      return section;
    });
    for (const section of state.sections) {
      if (next.sections.some(candidate => candidate.id === section.id)) continue;
      const controller = sections.get(section.id);
      if (!controller) continue;
      if (controller.receive(controller.getSnapshot().baseline)) sections.delete(section.id);
      else updated.push(section);
    }
    for (const [source, controller] of sources) receiveField(controller, next[source], sourceGeneration);
    publish({ structured: true, sections: updated });
  }

  async function run(field: StructuralField, { section, expectedSourceGeneration }: StructureChange) {
    if (!request && field === "technicalSpecificationAdd" && !state.structured && !await flushLegacy()) {
      publish({ issue: { error: "Сохраните исходное описание перед добавлением раздела.", retryable: true } });
      return false;
    }
    const controller = sections.get(section.id);
    if (!request && field === "technicalSpecificationRemove" && controller && !controller.receive(controller.getSnapshot().baseline)) {
      publish({ issue: { error: "Сохраните изменения в разделе перед удалением.", retryable: false } });
      return false;
    }
    const operation = request ??= {
      productId, clientMutationId: field === "technicalSpecificationAdd" ? section.id : id(), field, section, expectedSourceGeneration,
    };
    publish({
      lockedLegacy: field === "technicalSpecificationAdd" && !state.structured,
      lockedSectionId: field === "technicalSpecificationRemove" ? section.id : null,
    });
    let reply: ProductPatchResult;
    try {
      reply = await send(operation);
    } catch {
      publish({ issue: { error: "Ответ не получен. Повторите сохранение раздела.", retryable: true } });
      return false;
    }
    request = null;
    publish({ lockedLegacy: false, lockedSectionId: null });
    if (reply.kind !== "saved") {
      const error = reply.kind === "conflict" ? `${reply.error} Обновите карточку, чтобы увидеть актуальные разделы.` : reply.error;
      publish({ issue: { error, retryable: reply.kind === "failure" } });
      return false;
    }
    if (field === "technicalSpecificationAdd") {
      addSectionController(section, operation.expectedSourceGeneration);
      publish({ structured: true, sections: [...state.sections, section] });
    } else {
      sections.delete(section.id);
      publish({ sections: state.sections.filter(row => row.id !== section.id) });
    }
    return true;
  }

  let lastOperation: { field: StructuralField; change: StructureChange } | null = null;
  function changeStructure(field: StructuralField, change: StructureChange) {
    if (inflight || state.pending || (request && (request.field !== field || request.section.id !== change.section.id))) {
      return Promise.resolve(false);
    }
    lastOperation = { field, change };
    publish({ pending: true, issue: null });
    inflight = run(field, change).finally(() => {
      inflight = null;
      publish({ pending: false });
    });
    return inflight;
  }

  return {
    getSnapshot: () => state,
    getServerSnapshot: () => serverSnapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    section: (sectionId: string) => sections.get(sectionId)!,
    source: (source: Source) => sources.get(source)!,
    receive,
    add: (section: FurnitureSection) => changeStructure("technicalSpecificationAdd", { section, expectedSourceGeneration: sourceGeneration }),
    prepareRemove: async (sectionId: string) => {
      const controller = sections.get(sectionId);
      if (!controller || !await flushSketchCriticalFields([controller])) return null;
      const section = state.sections.find(row => row.id === sectionId);
      return section ? { section, expectedSourceGeneration: generations.get(controller)! } : null;
    },
    remove: (change: StructureChange) => changeStructure("technicalSpecificationRemove", change),
    retry: () => state.issue?.retryable && lastOperation
      ? changeStructure(lastOperation.field, lastOperation.change)
      : Promise.resolve(false),
    dismissIssue: () => {
      if (!state.issue?.retryable) publish({ issue: null });
    },
    flush: async () => {
      if (inflight && !await inflight) return false;
      if (state.issue) return false;
      return !state.structured || flushSketchCriticalFields([...sections.values(), ...sources.values()]);
    },
  };
}
