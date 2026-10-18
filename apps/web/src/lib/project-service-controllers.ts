import { createInlineSaveController, type InlineValue } from "./inline-save-controller";
import { parseProjectInlineValue } from "./project-inline-values";
import { PROJECT_SERVICE_FIELDS, type ProjectServiceField, type ProjectServiceSnapshot } from "./project-services";
import { projectPatchSchema, projectPricingProjectionSchema, type ProjectPatch, type ProjectPatchResult } from "../server/projects/patch-contract";

/** Услуги меняют общий режим: отправляем их последовательно с последним подтверждённым снимком. */
export function createProjectServiceControllers(projectId: string, initial: ProjectServiceSnapshot,
  save: (patch: ProjectPatch) => Promise<ProjectPatchResult>, initialVersion?: string) {
  let snapshot = initial;
  const serverSnapshot = initial;
  let version = initialVersion === undefined ? null : BigInt(initialVersion);
  const listeners = new Set<() => void>();
  let tail: Promise<unknown> = Promise.resolve();
  const uncertain = new Map<string, ProjectPatch>();
  function receive(next: ProjectServiceSnapshot, nextVersion?: string) {
    if (nextVersion !== undefined) {
      const nextId = BigInt(nextVersion);
      if (version !== null && nextId <= version) return false;
      version = nextId;
    }
    snapshot = next;
    for (const field of PROJECT_SERVICE_FIELDS) controllers[field].receive(next[field]);
    listeners.forEach(listener => listener());
    return true;
  }
  function field(name: ProjectServiceField) {
    return createInlineSaveController<InlineValue>({ initialValue: initial[name], format: value => value === null ? "" : String(value),
      parse: raw => parseProjectInlineValue(name, raw), save: request => {
        const operation = tail.then(async () => {
          // После потерянного ACK повторяется весь прежний запрос, включая CAS-снимок режима.
          const patch = uncertain.get(request.clientMutationId) ?? projectPatchSchema.parse({ projectId, field: name, ...request, expectedServices: snapshot });
          uncertain.set(request.clientMutationId, patch);
          const reply = await save(patch);
          uncertain.delete(request.clientMutationId);
          if (reply.kind === "saved" && reply.derived) {
            const parsed = projectPricingProjectionSchema.safeParse(reply.derived);
            if (parsed.success) receive({ servicesTotal: parsed.data.servicesTotal ?? null, delivery: parsed.data.delivery,
              unloading: parsed.data.unloading, installation: parsed.data.installation }, parsed.data.pricingVersion);
          }
          return reply;
        });
        tail = operation.catch(() => undefined);
        return operation;
      } });
  }
  const controllers = { servicesTotal: field("servicesTotal"), delivery: field("delivery"), unloading: field("unloading"), installation: field("installation") };
  return { controller: (name: ProjectServiceField) => controllers[name], receive,
    getSnapshot: () => snapshot, getServerSnapshot: () => serverSnapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    flush: async () => { for (const field of PROJECT_SERVICE_FIELDS) if (!await controllers[field].flush()) return false; return true; },
  };
}
