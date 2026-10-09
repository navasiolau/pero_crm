import { z } from "zod";

export const OBSOLETE_SKETCH_EVENT = "file.sketch-obsolete";
const component = z.string().min(1).max(255).refine(
  value => !/[\\/\\\\\u0000:]/.test(value) && value !== "." && value !== "..",
);
export const obsoleteSketchIntentSchema = z.object({
  projectId: component,
  productId: z.string().min(1).max(128),
  fileId: z.string().min(1).max(128),
  storedName: component,
  newFileId: z.string().min(1).max(128),
  clientMutationId: z.uuid(),
}).strict();
export type ObsoleteSketchIntent = z.infer<typeof obsoleteSketchIntentSchema>;
export const obsoleteSketchEventId = (mutationId: string) => `sketch-cleanup:${mutationId}`;
