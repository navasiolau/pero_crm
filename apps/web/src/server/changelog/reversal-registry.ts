import { productTitleReversal } from "@/server/products/title-reversal";
import { paymentVisibilityReversal } from "@/server/payments/visibility-reversal";
import { retainedFileReversal } from "@/server/files/retained-file-reversal";

export const journalReversals = [
  productTitleReversal,
  paymentVisibilityReversal,
  retainedFileReversal,
];
