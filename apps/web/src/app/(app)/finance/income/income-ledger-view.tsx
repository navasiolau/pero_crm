"use client";
import { OrganizationPaymentsView } from "@/components/organization-payments-view";
import type { OrganizationLedgerData } from "@/server/finance/organization-ledger";

export function IncomeLedgerView(props: OrganizationLedgerData) {
  return <OrganizationPaymentsView direction="INCOME" {...props} />;
}
