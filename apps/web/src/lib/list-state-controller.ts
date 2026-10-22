import { DEFAULT_LIST_QUERY, decodeListPreference, isEngineerFilterInitialized, normalizeListQuery, updateListQuery, type ListSection } from "./list-state";
import type { SaveListPreferenceResult } from "../server/list-preference-service";

export interface ListStateSnapshot { query: string; pending: boolean; revision: number; searchRevision: number }
export interface ListStateControllerOptions {
  section: ListSection;
  query: string;
  preference: string | null;
  save(query: string, expected: string | null): Promise<SaveListPreferenceResult>;
  navigate(query: string): void;
  isCurrent?(): boolean;
  onChange?(): void;
  onError?(error: unknown): void;
}

export class ListStateController {
  private snapshot: ListStateSnapshot;
  private preference: string | null;
  private active = false;
  private running = false;
  private requested: { query: string; revision: number; navigate: boolean; retries: number } | null = null;
  private issuedQueries = new Map<string, number>();

  constructor(private options: ListStateControllerOptions) {
    this.snapshot = { query: normalizeListQuery(options.section, options.query), pending: false, revision: 0, searchRevision: 0 };
    this.preference = options.preference;
  }
  getSnapshot = () => this.snapshot;

  start() {
    this.active = true;
    if (!isEngineerFilterInitialized(this.preference) || decodeListPreference(this.options.section, this.preference) !== this.snapshot.query) this.schedule(this.snapshot.query, false);
  }

  stop() {
    this.active = false;
    this.cancelPending();
  }

  cancelPending() {
    this.requested = null;
    this.issuedQueries.clear();
    this.snapshot = { ...this.snapshot, pending: false, revision: this.snapshot.revision + 1, searchRevision: this.snapshot.searchRevision + 1 };
    this.options.onChange?.();
  }

  observe(query: string, preference: string | null) {
    query = normalizeListQuery(this.options.section, query);
    // Более ранний собственный router.replace может завершиться после нового ввода.
    const ownNavigation = this.issuedQueries.get(query);
    if (ownNavigation !== undefined) {
      // Подтверждение нового перехода завершает и все вытесненные им старые.
      // Иначе последующая внешняя ссылка на старый query ошибочно считалась бы своей.
      for (const [issued, revision] of this.issuedQueries) {
        if (revision <= ownNavigation) this.issuedQueries.delete(issued);
      }
      if (query === this.snapshot.query && !this.running) this.preference = preference;
      return;
    }
    if (!this.running) this.preference = preference;
    this.requested = null;
    this.snapshot = { query, pending: this.running, revision: this.snapshot.revision + 1, searchRevision: this.snapshot.searchRevision + 1 };
    this.options.onChange?.();
    if (this.running || !isEngineerFilterInitialized(this.preference) || decodeListPreference(this.options.section, this.preference) !== query) this.schedule(query, false);
  }

  set(updates: Record<string, string | null>) {
    this.schedule(updateListQuery(this.options.section, this.snapshot.query, updates), true);
  }

  reset() {
    this.snapshot = { ...this.snapshot, searchRevision: this.snapshot.searchRevision + 1 };
    this.schedule(DEFAULT_LIST_QUERY, true);
  }

  private schedule(query: string, navigate: boolean) {
    if (!this.active) return;
    this.snapshot = { ...this.snapshot, query, pending: true, revision: this.snapshot.revision + 1 };
    this.requested = { query, revision: this.snapshot.revision, navigate, retries: 0 };
    this.options.onChange?.();
    void this.flush();
  }

  private current() { return this.active && (this.options.isCurrent?.() ?? true); }

  private async flush() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.current() && this.requested) {
        const request = this.requested;
        this.requested = null;
        try {
          const result = await this.options.save(request.query, this.preference);
          this.preference = result.value;
          if (!this.current() || request.revision !== this.snapshot.revision) continue;
          if (!result.ok) {
            if (request.retries >= 2) throw new Error("Список изменён в другом окне. Повторите изменение.");
            this.requested = { ...request, retries: request.retries + 1 };
            continue;
          }
          if (request.navigate) {
            this.issuedQueries.set(request.query, request.revision);
            this.options.navigate(request.query);
          }
        } catch (error) {
          if (this.current() && request.revision === this.snapshot.revision) this.options.onError?.(error);
        }
      }
    } finally {
      this.running = false;
      if (!this.current()) this.requested = null;
      this.snapshot = { ...this.snapshot, pending: false };
      this.options.onChange?.();
    }
  }
}

export function createListSearchDebouncer(apply: (value: string) => void, delay = 300, isCurrent: () => boolean = () => true) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let revision = 0;
  const cancel = () => { clearTimeout(timer); timer = undefined; revision++; };
  return {
    queue(value: string) {
      cancel();
      const scheduled = revision;
      timer = setTimeout(() => { if (scheduled === revision && isCurrent()) apply(value); }, delay);
    },
    cancel,
  };
}

// Та же привязка debounce, которую использует поле поиска; отдельная функция
// позволяет проверять совместный ввод фильтров без браузера и БД.
export function createListSearchDraft(controller: ListStateController) {
  let draftRevision = controller.getSnapshot().searchRevision;
  const debouncer = createListSearchDebouncer(
    (value) => controller.set({ q: value || null }), 300,
    () => controller.getSnapshot().searchRevision === draftRevision,
  );
  return {
    queue(value: string) {
      draftRevision = controller.getSnapshot().searchRevision;
      debouncer.queue(value);
    },
    cancel: debouncer.cancel,
  };
}
