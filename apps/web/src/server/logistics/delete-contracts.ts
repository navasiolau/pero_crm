import { z } from "zod";

export const logisticsTripDeleteSchema = z.object({
  tripId: z.uuid(), expectedRevision: z.number().int().min(1).max(2_147_483_646),
  clientMutationId: z.uuid().transform(value => value.toLowerCase()),
}).strict();
export type LogisticsTripDeleteInput = z.output<typeof logisticsTripDeleteSchema>;
export type LogisticsTripDeleteResult = { tripId: string; revision: number; deletedAt: string; repeated: boolean };
