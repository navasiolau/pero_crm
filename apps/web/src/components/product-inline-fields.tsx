"use client";
import { useSyncExternalStore, type ReactNode } from "react";
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
export function ProductInlineContacts({ canManage, clients, inheritedAddress }: {
  canManage: boolean; clients: { value: string; label: string; hint?: string }[]; inheritedAddress: string | null;
}) {
  const { controller, sourceClientId } = useProductInline();
  const client = controller("project.clientId");
  const selectedClient = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getServerSnapshot);
  const addressHint = inheritedAddress && selectedClient.baseline === sourceClientId && selectedClient.draft === sourceClientId ? `Адрес клиента: ${inheritedAddress}` : "Общий адрес для всех изделий проекта.";
  return <Card className="min-w-0"><CardContent className="flex min-w-0 flex-col gap-3 p-4 text-sm" data-product-contacts>
    <InlineSelectField id="product-inline-client" label="Клиент (общий для проекта)" controller={client} readOnly={!canManage} options={clients} hint="Смена клиента действует для всех изделий проекта." />
    <InlineTextField id="product-inline-address" label="Адрес проекта" controller={controller("project.address")} readOnly={!canManage} hint={addressHint} />
    <InlineTextField id="product-inline-phone" label="Телефон клиента *" controller={controller("client.phone")} inputMode="tel" readOnly={!canManage} hint="Телефон сохраняется в общей карточке выбранного клиента." />
  </CardContent></Card>;
}
export function ProductInlineDetails({ canManage, canEditTech, showAmount, currency, status, measurement, engineer }: {
  canManage: boolean; canEditTech: boolean; showAmount: boolean; currency: string;
  status: ReactNode; measurement: ReactNode; engineer: ReactNode;
}) {
  const { controller } = useProductInline();
  const price = controller("expectedPrice"); const quantity = controller("quantity");
  const p = useSyncExternalStore(price.subscribe, price.getSnapshot, price.getServerSnapshot);
  const q = useSyncExternalStore(quantity.subscribe, quantity.getSnapshot, quantity.getServerSnapshot);
  let total: string | null = null;
  if (/^\d{1,10}(?:[.,]\d{1,2})?$/.test(p.draft.trim()) && /^\d{1,10}$/.test(q.draft) && Number(q.draft) >= 1 && Number(q.draft) <= 2_147_483_647) {
    const [units, fraction = ""] = p.draft.replace(",", ".").split(".");
    const cents = (BigInt(units) * BigInt(100) + BigInt(fraction.padEnd(2, "0"))) * BigInt(q.draft);
    total = `${cents / BigInt(100)}.${String(cents % BigInt(100)).padStart(2, "0")}`;
  }
  return <div className="flex min-w-0 flex-col gap-4" data-product-details>
    <Card className="min-w-0"><CardContent className="flex min-w-0 flex-col gap-3 p-4 text-sm">
      <div className="min-w-0 space-y-1.5"><div className="text-sm font-medium">Статус</div>{status}</div>
      <InlineTextField id="product-inline-quantity" label="Количество, шт." controller={quantity} inputMode="numeric" readOnly={!canManage} />
    </CardContent></Card>
    <Card className="min-w-0"><CardContent className="min-w-0 p-4"><InlineTextField id="product-inline-description" label="Техническое описание" controller={controller("description")} readOnly={!canEditTech} multiline largeDescription /></CardContent></Card>
    {measurement}
    {showAmount ? <Card className="min-w-0"><CardContent className="grid min-w-0 grid-cols-2 gap-3 p-4 text-sm">
      <InlineTextField id="product-inline-price" label={`Цена за 1 шт., ${currency}`} controller={price} inputMode="decimal" readOnly={!canManage} />
      <div className="min-w-0 break-words"><div className="text-muted-foreground">Сумма партии</div>{formatAmount(total, currency)}{[p.status, q.status].some(value => ["dirty", "saving", "error", "conflict"].includes(value)) ? <span className="block text-xs text-muted-foreground">По текущему вводу; сохранение подтверждается рядом с полем.</span> : null}</div>
    </CardContent></Card> : null}
    {engineer}
  </div>;
}