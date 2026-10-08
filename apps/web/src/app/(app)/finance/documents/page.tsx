import { requireFinance } from "@/server/require-role";
import {redirect} from 'next/navigation';

export const dynamic = "force-dynamic";
export default async function FinanceDocumentsPage() {
  await requireFinance();
  redirect('/finance/expenses');
}
