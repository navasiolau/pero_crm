import { MAX_LIST_QUERY_LENGTH, normalizeListQuery } from "./list-state";

export function projectDetailHref(projectId: string, query: string): string {
  const returnTo = `/projects?${normalizeListQuery("projects", query)}`;
  return `/projects/${encodeURIComponent(projectId)}?${new URLSearchParams({ returnTo })}`;
}

export function resolveProjectReturn(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_LIST_QUERY_LENGTH + "/projects?".length || /[\\#\u0000-\u001f\u007f]/.test(value)) return "/projects";
  if (value === "/projects") return "/projects";
  if (value.startsWith("/projects?")) return `/projects?${normalizeListQuery("projects", value.slice("/projects?".length))}`;
  return "/projects";
}
