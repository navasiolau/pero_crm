import { MAX_LIST_QUERY_LENGTH, type ListSection } from "./list-state";

export interface KanbanPosition {
  version: 1;
  query: string;
  left: number;
  top: number;
  viewport: { width: number; height: number };
  anchor: { id: string; x: number; y: number } | null;
}

type PositionStorage = Pick<Storage, "getItem" | "setItem">;
export type KanbanScope = ListSection | `projects/${string}`;

const memory = new Map<string, KanbanPosition>();
const coordinate = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 10_000_000;
const key = (userId: string, scope: KanbanScope) => `pero:kanban-position:v1:${encodeURIComponent(userId)}:${scope}`;

function sessionStorage(): PositionStorage | null {
  try { return window.sessionStorage; } catch { return null; }
}

export function decodeKanbanPosition(raw: string | null, query: string): KanbanPosition | null {
  if (!raw || raw.length > MAX_LIST_QUERY_LENGTH + 2048) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const position = value as Partial<KanbanPosition>;
    if (position.version !== 1 || position.query !== query || query.length > MAX_LIST_QUERY_LENGTH
      || !coordinate(position.left) || position.left < 0 || !coordinate(position.top) || position.top < 0) return null;
    const anchor = position.anchor;
    const viewport = position.viewport;
    if (!viewport || !coordinate(viewport.width) || viewport.width <= 0 || !coordinate(viewport.height) || viewport.height <= 0) return null;
    if (anchor !== null && (!anchor || typeof anchor !== "object" || typeof anchor.id !== "string" || !anchor.id || anchor.id.length > 200
      || !coordinate(anchor.x) || !coordinate(anchor.y))) return null;
    return { version: 1, query, left: position.left, top: position.top, viewport: { width: viewport.width, height: viewport.height }, anchor: anchor ? { id: anchor.id, x: anchor.x, y: anchor.y } : null };
  } catch { return null; }
}

export function readKanbanPosition(userId: string, scope: KanbanScope, query: string, storage = sessionStorage()): KanbanPosition | null {
  const storageKey = key(userId, scope);
  try {
    if (storage) return decodeKanbanPosition(storage.getItem(storageKey), query);
  } catch { /* Запрет storage не должен ломать переход в карточку. */ }
  const fallback = memory.get(storageKey);
  return fallback?.query === query ? fallback : null;
}

export function writeKanbanPosition(userId: string, scope: KanbanScope, position: KanbanPosition, storage = sessionStorage()): void {
  const storageKey = key(userId, scope);
  memory.delete(storageKey);
  memory.set(storageKey, position);
  if (memory.size > 8) memory.delete(memory.keys().next().value!);
  try { storage?.setItem(storageKey, JSON.stringify(position)); } catch { /* Остаётся снимок текущей вкладки в памяти. */ }
}
