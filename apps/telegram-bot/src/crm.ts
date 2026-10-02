import { config } from "./config";

// Клиент REST CRM /api/v1/bot/*. Ответы домена всегда {ok, error?, ...} —
// HTTP 200/4xx; исключения бросаем только для инфраструктурных сбоев.

export interface SessionInfo {
  found: boolean;
  user?: { id: string; name: string; roles: string[]; botAllowed: boolean };
}

export interface OrdinaryProjectPatch {projectId:string;field:"title"|"address"|"managerId";value:string|null;expectedValue:string|null;clientMutationId:string;}
export interface ProjectPatchAck {ok:boolean;kind:"saved"|"validation"|"conflict"|"forbidden"|"not-found"|"failure";error?:string;clientMutationId?:string;currentValue?:string|null;replayed?:boolean;}
export interface ProjectRef {
  id: string;
  number: string;
  title: string;
  stage: string;
  currency: string;
}

export interface ProjectBaseline {
  title: string; clientId: string; managerId: string | null; address: string | null;
  delivery: string | null; unloading: string | null; installation: string | null; currency: string;
}
export interface ProjectCard {
  fullBaseline: ProjectBaseline;
  id: string;
  number: string;
  title: string;
  stage: string;
  stageChangedAt: string;
  currency: string;
  address: string | null;
  client: string;
  clientPhone: string;
  managerName: string | null;
  productsCount: number;
  totalExpected: number;
}

export interface FinanceInfo {
  incomeByn: string;
  expenseByn: string;
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
  async health(): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`${config.crmBaseUrl}/api/v1`, {
        headers: { authorization: `Bearer ${config.crmApiToken}` },
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new CrmError("CRM health check failed");
    }
    const result = (await response.json().catch(() => null)) as {
      service?: string;
      api?: string;
    } | null;
    if (
      !response.ok ||
      result?.service !== "PERO CRM" ||
      result.api !== "v1"
    ) {
      throw new CrmError("CRM health check failed");
    }
  },
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
  patchProject(actorId:string,id:string,input:OrdinaryProjectPatch){
    return request<ProjectPatchAck>("PATCH",`/projects/${id}`,input,actorId);
  },
  changeStage(
    actorId: string,
    id: string,
    toStage: string,
    extras: Record<string, string> | undefined,
    expectedStage: string, clientMutationId: string,
  ) {
    return request<{ ok: boolean; error?: string }>(
      "POST",
      `/projects/${id}/stage`,
      { toStage, extras,expectedStage,clientMutationId },
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
