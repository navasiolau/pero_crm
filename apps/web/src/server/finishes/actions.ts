"use server";

import { saveCompositionFinish as saveInComposition, deleteCompositionFinish as deleteInComposition } from "@/server/composition/actions";

/** UI entry points retain the same authenticated composition action contract. */
export async function saveCompositionFinish(input: Parameters<typeof saveInComposition>[0]) {
  return saveInComposition(input);
}

export async function deleteCompositionFinish(input: Parameters<typeof deleteInComposition>[0]) {
  return deleteInComposition(input);
}
