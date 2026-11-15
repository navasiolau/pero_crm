/** Безопасные данные журнала, пригодные для передачи через RSC и Server Actions. */
export type JournalValue = null | boolean | number | string | JournalValue[] | { [key: string]: JournalValue };

export type JournalScope = { kind: "global" } | { kind: "project" | "product"; id: string };

export interface JournalEntryInput {
  id?: string;
  actorType: string;
  actorId: string;
  actorName?: string | null;
  entity: string;
  entityId: string;
  action: string;
  field?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  source?: string | null;
  createdAt?: Date | string;
}

export interface JournalPerson { id: string; name: string }
export interface JournalActor extends JournalPerson { type: "user" | "system" }
export interface JournalEntityReference { type: string; id: string; label: string; href?: string }
export interface JournalContext { kind: "project" | "product"; id: string; label: string; href?: string }
export interface JournalChange {
  path: string;
  label: string;
  before: JournalValue;
  after: JournalValue;
  beforeKnown: boolean;
  afterKnown: boolean;
}

export interface JournalPresentation {
  version: 1;
  kind: "event" | "receipt" | "excluded";
  actor: JournalActor;
  initiator?: JournalPerson;
  reason?: string;
  entity: JournalEntityReference;
  contexts: JournalContext[];
  action: { code: string; label: string };
  source: { code: string; label: string };
  changes: JournalChange[];
  links: JournalEntityReference[];
  technical: Record<string, JournalValue>;
}

/** Снимки не подменяют raw payload: receipt продолжает использовать исходные значения. */
export interface JournalPresentationHints {
  actor?: JournalActor;
  initiator?: JournalPerson;
  reason?: string;
  entity?: Partial<JournalEntityReference>;
  contexts?: JournalContext[];
  links?: JournalEntityReference[];
  before?: unknown;
  after?: unknown;
  beforeKnown?: boolean;
  afterKnown?: boolean;
  changes?: JournalChange[];
  kind?: JournalPresentation["kind"];
}
