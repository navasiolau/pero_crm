"use server";

import type { ProjectStage } from "@prisma/client";
import type { z } from "zod";

import { patchProjectCore } from "./project-field-core";
import { projectPatchSchema, malformedProjectPatch, type ProjectPatch, type ProjectPatchResult } from "./patch-contract";
import { auth } from "@/auth";

import {
  changeProjectStageCore,
  createProjectCore,
  createProjectSchema,
  updateProjectCore,
  updateProjectSchema,
  type StageExtras,
} from "./core";

// Server actions — тонкие обёртки над ядрами (./core): сессия → актёр
// (source "web"), вся логика и проверки ролей — в ядре, чтобы её переиспользовал
// telegram-бот (source "telegram").

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  return session;
}

function actorFromSession(session: Awaited<ReturnType<typeof requireUser>>) {
  return {
    id: session.user.id,
    name: session.user.name ?? "",
    roles: session.user.roles,
    source: "web" as const,
  };
}

export async function createProject(
  input: z.input<typeof createProjectSchema>,
): Promise<{ ok: boolean; id?: string; number?: string; error?: string }> {
  const session = await requireUser();
  return createProjectCore(actorFromSession(session), input);
}

export async function updateProject(
  projectId: string,
  input: z.input<typeof updateProjectSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireUser();
  return updateProjectCore(actorFromSession(session), projectId, input);
}

export async function changeProjectStage(
  projectId: string,
  toStage: ProjectStage,
  extras?: StageExtras,
  expectedStage?: ProjectStage,
  clientMutationId?: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireUser();
  return changeProjectStageCore(actorFromSession(session), projectId, toStage, extras, expectedStage, clientMutationId);
}

/** Независимый field Server Action не вызывает cache/router invalidation. */
export async function patchProject(input:ProjectPatch):Promise<ProjectPatchResult> {
 const session=await auth();
 if(!session?.user){const parsed=projectPatchSchema.safeParse(input);if(!parsed.success)return malformedProjectPatch(input);return{kind:"forbidden",field:parsed.data.field,clientMutationId:parsed.data.clientMutationId,error:"Не авторизован"};}
 return patchProjectCore(actorFromSession(session),input);
}
