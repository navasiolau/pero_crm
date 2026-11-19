import { logisticsReallocationReversal } from "@/server/logistics/reallocation-reversal";
import { productTitleReversal } from "@/server/products/title-reversal";

export const journalReversals = [productTitleReversal, logisticsReallocationReversal];
