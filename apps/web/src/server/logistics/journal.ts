import type { JournalPresentationHints } from "@/server/changelog/contract";
import { journalProductContext, journalProjectContext } from "@/server/finance/journal";

type TripJournalRecord = {
  id: string; date?: Date;
  shares?: readonly { projectId: string; project?: { number: string } }[];
  lines?: readonly { productId: string | null; materialId?: string | null; numberSnapshot: string | null; nameSnapshot?: string }[];
};

/** Прямые связи рейса сохраняются до удаления/замены состава, без поиска по текущему графу. */
export function logisticsJournalHints(row: TripJournalRecord, previous?: TripJournalRecord): JournalPresentationHints {
  const records = [previous, row].filter((value): value is TripJournalRecord => !!value);
  const contexts = new Map<string, NonNullable<JournalPresentationHints["contexts"]>[number]>();
  const links = new Map<string, NonNullable<JournalPresentationHints["links"]>[number]>();
  for (const record of records) {
    for (const share of record.shares ?? []) {
      const context = journalProjectContext({ id: share.projectId, number: share.project?.number });
      contexts.set(`project:${context.id}`, context);
      links.set(`project:${context.id}`, { ...context, type: "project" });
    }
    for (const line of record.lines ?? []) {
      if (line.productId) {
        const context = journalProductContext({ id: line.productId, number: line.numberSnapshot });
        contexts.set(`product:${context.id}`, context);
        links.set(`product:${context.id}`, { ...context, type: "product" });
      }
      if (line.materialId) links.set(`material:${line.materialId}`, { type: "material", id: line.materialId,
        label: line.nameSnapshot ? `Материал ${line.nameSnapshot}` : "Материал" });
    }
  }
  return { entity: { label: row.date ? `Рейс от ${row.date.toISOString().slice(0, 10).split("-").reverse().join(".")}` : "Рейс",
    href: `/logistics?trip=${encodeURIComponent(row.id)}` }, contexts: [...contexts.values()], links: [...links.values()] };
}
