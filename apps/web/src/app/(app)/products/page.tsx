import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { displayClientName } from "@/lib/labels";
import { listProducts } from "@/server/products/queries";

import { ProductsTable } from "./products-table";

export const dynamic = "force-dynamic";

// Раздел «Изделия» — все изделия организации (офисные роли, §4);
// работник/монтажник — изделия проектов со своими задачами.
export default async function ProductsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = session.user.role;

  const products = await listProducts(session.user.id, role);

  return (
    <ProductsTable
      products={products.map((product) => ({
        id: product.id,
        number: product.number,
        title: product.title,
        status: product.status,
        expectedPrice: product.expectedPrice?.toString() ?? null,
        currency: product.project.currency,
        projectId: product.project.id,
        projectNumber: product.project.number,
        projectTitle: product.project.title,
        clientName: displayClientName(product.project.client),
      }))}
      showAmount={["ADMIN", "DIRECTOR", "MANAGER", "ENGINEER", "ACCOUNTANT"].includes(role)}
    />
  );
}
