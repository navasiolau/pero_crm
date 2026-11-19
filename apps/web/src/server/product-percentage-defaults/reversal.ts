import { defineFieldReversal } from "@/server/changelog/field-reversal";
import { defaultsSnapshotSchema, DEFAULT_PERCENTAGE_KEY } from "./contracts";
import { readProductPercentageDefaults, writeProductPercentageDefaultsInTransaction } from "./core";

export const defaultsReversalKind = "orgSetting.percentageDefaults";
export const productPercentageDefaultsReversal = defineFieldReversal({
  kind: defaultsReversalKind, entity: "orgSetting", field: "rates",
  value: defaultsSnapshotSchema.shape.rates,
  async lock(tx) { await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`; },
  async read(tx, id) {
    if (id !== DEFAULT_PERCENTAGE_KEY) return null;
    const snapshot = await readProductPercentageDefaults(tx);
    return { value: snapshot.rates, revision: snapshot.revision };
  },
  async update({ tx }, _expected, value) {
    const current = await readProductPercentageDefaults(tx);
    const snapshot = await writeProductPercentageDefaultsInTransaction(tx, current.revision, value);
    return { value: snapshot.rates, revision: snapshot.revision, cachePaths: ["/settings/product-percentages", "/products"] };
  },
});
