import { productFieldReversals, productTitleReversal } from "@/server/products/title-reversal";
import { productSpecificationReversal } from "@/server/products/specification-reversal";
import { projectFieldReversals } from "@/server/projects/field-reversal";
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
import { expenseReceiptIssueReversal } from "@/server/warehouse/expense-issue-reversal";
import { workTaskLifecycleReversal } from "@/server/tasks/lifecycle-reversal";
import { taskEditReversal } from "@/server/tasks/edit-reversal";
import { workEditReversal } from "@/server/works/edit-reversal";
import { payoutVisibilityReversal } from "@/server/payroll/payout-reversal";
import { payrollAccrualReversal } from "@/server/payroll/accrual-reversal";
import { cardVisibilityReversal } from "@/server/projects/card-visibility-reversal";
import { userSettingsReversal } from "@/server/users/settings-reversal";
import { notificationPreferenceReversal } from "@/server/notifications/preference-reversal";
import { viewPreferenceReversal } from "@/server/view-preference-reversal";
import { telegramLinkReversal } from "@/server/telegram/link-reversal";
import { savedListChoiceReversal } from "@/server/list-preference-reversal";
import { warehouseCatalogReversal } from "@/server/warehouse/catalog-reversal";
import { officeDirectoryReversal } from "./office-directory-reversal";
import { signatureSettingsReversal } from "@/server/kp/signature-settings";
import { warehouseMovementReversal } from "@/server/warehouse/movement-reversal";
import { logisticsTripLifecycleReversal, logisticsDocumentVisibilityReversal } from "@/server/logistics/lifecycle-reversal";
import { projectStageReversal } from "@/server/projects/stage-reversal";
import { productStatusReversal } from "@/server/products/status-reversal";
import { productPercentageDefaultsReversal } from "@/server/product-percentage-defaults/reversal";
import { productPercentageSettingsReversal } from "@/server/product-percentage-pay/settings-reversal";

export const journalReversals = [
  ...productFieldReversals,
  productSpecificationReversal,
  ...projectFieldReversals,
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
  expenseReceiptIssueReversal,
  workTaskLifecycleReversal,
  taskEditReversal,
  workEditReversal,
  payoutVisibilityReversal,
  payrollAccrualReversal,
  cardVisibilityReversal,
  userSettingsReversal,
  notificationPreferenceReversal,
  viewPreferenceReversal,
  telegramLinkReversal,
  savedListChoiceReversal,
  warehouseCatalogReversal,
  officeDirectoryReversal,
  productTitleReversal,
  signatureSettingsReversal,
  warehouseMovementReversal,
  logisticsTripLifecycleReversal,
  logisticsDocumentVisibilityReversal,
  projectStageReversal,
  productStatusReversal,
  productPercentageDefaultsReversal,
  productPercentageSettingsReversal,
];
