import FurnitureSpecifications from "@pero/kp-template/furniture-specifications";
import type { FurnitureSectionType, TechnicalSpecifications } from "@pero/kp-template";
import { createInlineSaveController, type InlineSaveController } from "@/lib/inline-save-controller";
import type { ProductPatch, ProductPatchResult } from "@/server/products/patch-contract";

type SectionType = Exclude<FurnitureSectionType, "custom">;

export function createProductTechnicalEditor({ productId, initial, send, id = () => crypto.randomUUID() }: {
  productId: string;
  initial: TechnicalSpecifications | null;
  send: (patch: ProductPatch) => Promise<ProductPatchResult>;
  id?: () => string;
}) {
  const controllers = new Map<SectionType, InlineSaveController<string>>();
  const identities = new Map<SectionType, { sectionId: string | null; generation: number }>();
  for (const item of FurnitureSpecifications.CATALOG) {
    const section = initial?.sections.find(section => section.type === item.type);
    identities.set(item.type, { sectionId: section?.id ?? null, generation: initial?.sourceGeneration ?? 0 });
    const controller = createInlineSaveController<string>({
      initialValue: section?.value ?? "", format: value => value, parse: value => value, id,
      save: async request => {
        const identity = identities.get(item.type)!;
        const reply = await send({ productId, field: "technicalSpecificationEntry", type: item.type,
          expectedSectionId: identity.sectionId, expectedSourceGeneration: identity.generation, ...request });
        if (reply.kind === "saved" && reply.derived?.technicalSpecificationSectionId !== undefined) {
          identity.sectionId = reply.derived.technicalSpecificationSectionId;
        }
        return reply as typeof reply & { value: string; currentValue?: string };
      },
    });
    controllers.set(item.type, controller);
  }
  return {
    section: (type: SectionType) => controllers.get(type)!,
    receive: (next: TechnicalSpecifications | null) => {
      for (const item of FurnitureSpecifications.CATALOG) {
        const section = next?.sections.find(section => section.type === item.type);
        if (controllers.get(item.type)!.receive(section?.value ?? "")) {
          identities.set(item.type, { sectionId: section?.id ?? null, generation: next?.sourceGeneration ?? 0 });
        }
      }
    },
    flush: async () => (await Promise.all([...controllers.values()].map(controller => {
      const state = controller.getSnapshot();
      return ["idle", "saved"].includes(state.status) && state.draft === state.baseline ? true : controller.flush();
    }))).every(Boolean),
  };
}
