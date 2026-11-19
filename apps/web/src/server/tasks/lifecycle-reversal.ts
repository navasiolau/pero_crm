import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { changeWorkTaskLifecycle, previewWorkTaskLifecycle, WorkTaskLifecycleRefusal } from "./lifecycle-core";
import { workTaskLifecycleKind, workTaskLifecycleSchema } from "./lifecycle-contract";

export const workTaskLifecycleReversal = defineJournalReversal({
  kind: workTaskLifecycleKind,
  version: 1,
  schema: workTaskLifecycleSchema,
  async preview(ctx, data) {
    try {
      await previewWorkTaskLifecycle(ctx.tx, ctx.actor.id, data);
      return null;
    } catch (error) {
      if (error instanceof WorkTaskLifecycleRefusal) return error.message;
      throw error;
    }
  },
  async apply(ctx, data) {
    try {
      const result = await changeWorkTaskLifecycle(ctx.tx, ctx.actor, data.entity, data.id, data, "journal.reverse", false);
      return { inverse: result.inverse, oldValue: result.before, newValue: result.after, hints: result.hints, cachePaths: result.cachePaths };
    } catch (error) {
      if (error instanceof WorkTaskLifecycleRefusal) throw new JournalReversalRefusal(error.message);
      throw error;
    }
  },
});
