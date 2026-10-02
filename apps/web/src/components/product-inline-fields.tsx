"use client";
import { useSyncExternalStore } from "react";
import Link from "next/link";
import { InlineTextField, InlineSelectField } from "@/components/inline-fields";
import { Card, CardContent } from "@/components/ui/card";
import { useProductInline } from "@/components/product-inline-provider";
import { formatAmount } from "@/lib/format";
export function ProductInlineTitle({ number, canManage }: { number: string; canManage: boolean }) {
  const { controller } = useProductInline();
  const title = controller("title");
  const state = useSyncExternalStore(title.subscribe, title.getSnapshot, title.getServerSnapshot);
  return <div className="min-w-0 flex-1"><h1 className="sr-only">{number} · {state.draft}</h1><span className="text-sm text-muted-foreground">{number}</span><InlineTextField id="product-inline-title" label="Название изделия" inputClassName="h-auto text-lg font-semibold" controller={title} readOnly={!canManage} /></div>;
}
export function ProductInlineDetails({ canManage, canEditTech, showAmount, currency, clients, engineers, inheritedAddress, surveyor, project, initialPrice }: {
  canManage: boolean; canEditTech: boolean; showAmount: boolean; currency: string; clients: { value: string; label: string; hint?: string }[]; engineers: { value: string; label: string; disabled?: boolean }[]; inheritedAddress: string | null; surveyor: React.ReactNode; project: { id: string; number: string; title: string }; initialPrice: string | null;
}) {
  const { controller, sourceClientId } = useProductInline();
  const client = controller("project.clientId");
  const selectedClient = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getServerSnapshot);
  const addressHint = inheritedAddress && selectedClient.baseline === sourceClientId && selectedClient.draft === sourceClientId ? `Адрес клиента: ${inheritedAddress}` : "Общий адрес для всех изделий проекта.";
  const price = controller("expectedPrice"); const quantity = controller("quantity");
  const p = useSyncExternalStore(price.subscribe, price.getSnapshot, price.getServerSnapshot);
  const q = useSyncExternalStore(quantity.subscribe, quantity.getSnapshot, quantity.getServerSnapshot);
  let total: string | null = null;
  if (/^\d{1,10}(?:[.,]\d{1,2})?$/.test(p.draft.trim()) && /^\d{1,10}$/.test(q.draft) && Number(q.draft) >= 1 && Number(q.draft) <= 2_147_483_647) {
    const [units, fraction = ""] = p.draft.replace(",", ".").split(".");
    const cents = (BigInt(units) * BigInt(100) + BigInt(fraction.padEnd(2, "0"))) * BigInt(q.draft);
    total = `${cents / BigInt(100)}.${String(cents % BigInt(100)).padStart(2, "0")}`;
  }
  return <div className="flex min-w-0 flex-col gap-4">
    <Card><CardContent className="grid min-w-0 gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2">
      <InlineTextField id="product-inline-kind" label="Вид изделия" controller={controller("kind")} readOnly={!canManage} />
      <InlineSelectField id="product-inline-client" label="Клиент (общий для проекта)" controller={controller("project.clientId")} readOnly={!canManage} options={clients} hint="Смена клиента действует для всех изделий проекта." />
      <InlineTextField id="product-inline-address" label="Адрес проекта" controller={controller("project.address")} readOnly={!canManage} hint={addressHint} />
      <InlineTextField id="product-inline-phone" label="Телефон клиента *" controller={controller("client.phone")} inputMode="tel" readOnly={!canManage} hint="Телефон сохраняется в общей карточке выбранного клиента." />
      <div className="min-w-0 break-words"><div className="text-muted-foreground">Замерщик</div>{surveyor}</div>
      <InlineSelectField id="product-inline-engineer" label="Инженер" controller={controller("engineerId")} readOnly={!canManage} options={engineers} allowClear />
      <InlineTextField id="product-inline-quantity" label="Количество, шт." controller={quantity} inputMode="numeric" readOnly={!canManage} />
      {showAmount ? <><InlineTextField id="product-inline-price" label={`Цена за 1 шт., ${currency}`} controller={price} inputMode="decimal" readOnly={!canManage} /><div className="min-w-0 break-words"><div className="text-muted-foreground">Сумма партии</div>{formatAmount(total, currency)}{[p.status, q.status].some(status => ["dirty", "saving", "error", "conflict"].includes(status)) ? <span className="block text-xs text-muted-foreground">По текущему вводу; сохранение подтверждается рядом с полем.</span> : null}</div><div className="min-w-0 break-words"><div className="text-muted-foreground">Первоначальная цена за 1 шт. (КП)</div>{formatAmount(initialPrice, currency)}</div></> : null}
    </CardContent></Card>
    <Card><CardContent className="min-w-0 p-4"><InlineTextField id="product-inline-description" label="Техническое описание" controller={controller("description")} readOnly={!canEditTech} multiline /></CardContent></Card>
    <div className="min-w-0 break-words text-sm text-muted-foreground">Проект: <Link href={`/projects/${project.id}`} className="text-foreground underline-offset-2 hover:underline">{project.number} · {project.title}</Link></div>
  </div>;
}
