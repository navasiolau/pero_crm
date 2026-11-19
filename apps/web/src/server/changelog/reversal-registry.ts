import { productTitleReversal } from "@/server/products/title-reversal";
import { paymentVisibilityReversal } from "@/server/payments/visibility-reversal";
import { retainedFileReversal } from "@/server/files/retained-file-reversal";
import { expenseReceiptReversal } from "@/server/warehouse/expense-receipt-reversal";
import { ordinaryExpenseProjectReversal } from "@/server/payments/project-assignment-core";
import { proposalMediaUploadReversal } from "@/server/kp/media-upload-reversal";
import { proposalEditReversal } from "@/server/kp/edit-reversal";
import { proposalCreationReversal } from "@/server/kp/proposal-create-reversal";
import { proposalExportRequestReversal } from "@/server/kp/export-request-reversal";
import { issuedProposalPdfReversal } from "@/server/kp/issued-pdf-reversal";
import { issuedContractDocxReversal } from "@/server/kp/issued-docx-reversal";
import { createdContractDraftReversal, savedContractDraftReversal } from "@/server/kp/contract-draft-reversal";
import { contractPublicationReversal } from "@/server/kp/contract-publication-reversal";
import { logisticsReallocationReversal } from "@/server/logistics/reallocation-reversal";

import { officeDirectoryReversal } from "./office-directory-reversal";

export const journalReversals = [
  officeDirectoryReversal,
  productTitleReversal,
  paymentVisibilityReversal,
  retainedFileReversal,
  expenseReceiptReversal,
  ordinaryExpenseProjectReversal,
  proposalMediaUploadReversal,
  proposalEditReversal,
  proposalCreationReversal,
  proposalExportRequestReversal,
  issuedProposalPdfReversal,
  issuedContractDocxReversal,
  createdContractDraftReversal,
  savedContractDraftReversal,
  contractPublicationReversal,
  logisticsReallocationReversal,
];
