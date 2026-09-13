import { config } from "./config";

// Клиент REST CRM /api/v1/bot/*. Ответы домена всегда {ok, error?, ...} —
// HTTP 200/4xx; исключения бросаем только для инфраструктурных сбоев.

export interface SessionInfo {
  found: boolean;
  user?: { id: string; name: string; roles: string[]; botAllowed: boolean };
}

export interface ProjectRef {
  id: string;
  number: string;
  title: string;
  stage: string;
  currency: string;
}

export interface ProjectCard {
  id: string;
  number: string;
  title: string;
  stage: string;
  stageChangedAt: string;
  currency: string;
  address: string | null;
  initialPrice: number | null;
  client: string;
  clientPhone: string;
  managerName: string | null;
  productsCount: number;
  totalExpected: number;
}

export interface FinanceInfo {
  incomeByn: number;
  expenseByn: number;
}

export interface DirectoryItem {
  id: string;
  label: string;
  phone?: string;
  currency?: string;
}

export class CrmError extends Error {}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  actorId?: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${config.crmBaseUrl}/api/v1/bot${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.crmApiToken}`,
        ...(actorId ? { "x-acting-user": actorId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new CrmError("CRM недоступна — попробуйте позже");
  }
  if (response.status === 401) {
    throw new CrmError("CRM отклонила токен бота — проверьте CRM_API_TOKEN");
  }
  const data = (await response.json().catch(() => null)) as
    | (T & { ok?: boolean; error?: string })
    | null;
  if (!data) {
    throw new CrmError(`CRM вернула HTTP ${response.status}`);
  }
  return data as T;
}

export const crm = {
  register(username: string) {
    return request<{ ok: boolean }>("POST", "/register", { username });
  },
  session(chatId: string) {
    return request<SessionInfo>("GET", `/session?chatId=${encodeURIComponent(chatId)}`);
  },
  link(code: string, chatId: string, username?: string) {
    return request<{
      ok: boolean;
      error?: string;
      user?: { name: string; roles: string[]; botAllowed: boolean };
    }>("POST", "/link", { code, chatId, username });
  },
  unlink(chatId: string) {
    return request<{ ok: boolean }>("DELETE", "/unlink", { chatId });
  },
  projects(actorId: string, q?: string) {
    return request<{ ok: boolean; error?: string; projects?: ProjectRef[] }>(
      "GET",
      `/projects${q ? `?q=${encodeURIComponent(q)}` : ""}`,
      undefined,
      actorId,
    );
  },
  project(actorId: string, id: string) {
    return request<{
      ok: boolean;
      error?: string;
      project?: ProjectCard;
      finance?: FinanceInfo | null;
    }>("GET", `/projects/${id}`, undefined, actorId);
  },
  createProject(actorId: string, input: Record<string, unknown>) {
    return request<{ ok: boolean; error?: string; number?: string }>(
      "POST",
      "/projects",
      input,
      actorId,
    );
  },
  updateProject(actorId: string, id: string, input: Record<string, unknown>) {
    return request<{ ok: boolean; error?: string }>(
      "PATCH",
      `/projects/${id}`,
      input,
      actorId,
    );
  },
  changeStage(
    actorId: string,
    id: string,
    toStage: string,
    extras?: Record<string, string>,
  ) {
    return request<{ ok: boolean; error?: string }>(
      "POST",
      `/projects/${id}/stage`,
      { toStage, extras },
      actorId,
    );
  },
  createPayment(actorId: string, input: Record<string, unknown>) {
    return request<{ ok: boolean; error?: string }>(
      "POST",
      "/payments",
      input,
      actorId,
    );
  },
  directory(actorId: string, type: string, q?: string) {
    return request<{ ok: boolean; error?: string; items?: DirectoryItem[] }>(
      "GET",
      `/directory?type=${type}${q ? `&q=${encodeURIComponent(q)}` : ""}`,
      undefined,
      actorId,
    );
  },
};
