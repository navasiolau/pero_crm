"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ProductStatus, Role } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { useProductInline } from "@/components/product-inline-provider";
import { PRODUCT_STATUSES, productStatusLabels, productStatusStyles } from "@/lib/product-statuses";
import { cn } from "@/lib/utils";
import { productStatusTargets, shouldRollbackProductStatus } from "@/lib/product-percentage-ui";
import { changeProductStatus, deleteProduct, updateProduct } from "@/server/products/actions";

export function ProductHeader({
  product,
  currency,
  canManage,
  showAmount,
  actorRoles,
  hasB3d,
  noModel,
  isEngineeringParticipant,
}: {
  product: {
    id: string;
    number: string;
    title: string;
    kind: string | null;
    status: ProductStatus;
    expectedPrice: string | null;
    quantity: number;
    initialPrice: string | null;
    description: string | null;
    projectId: string;
    engineerId: string | null;
  };
  currency: string;
  canManage: boolean;
  showAmount: boolean;
  actorRoles: readonly Role[];
  hasB3d: boolean;
  noModel: boolean;
  isEngineeringParticipant: boolean;
}) {
  const router = useRouter();
  const inline = useProductInline();
  const [pending, startTransition] = useTransition();
  const [localStatus, setLocalStatus] = useState(product.status);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [initialPrice, setInitialPrice] = useState(product.initialPrice ?? "");
  const parsedInitialPrice = initialPrice.trim() === "" ? null : Number(initialPrice);
  const initialValid = parsedInitialPrice === null || (Number.isFinite(parsedInitialPrice) && parsedInitialPrice >= 0);
  const allowedStatusTargets = productStatusTargets(actorRoles, { from: localStatus, assignedEngineer: isEngineeringParticipant, participant: isEngineeringParticipant, hasB3d, noModel });
  const canEngineerStart = !canManage && actorRoles.includes("ENGINEER") && isEngineeringParticipant && localStatus === "DESIGN";
  async function moveStatus(toStatus: ProductStatus) {
    setStatusError(null);
    if (!await inline.flush()) { setStatusError("Сначала сохраните цену, количество, инженера и настройки процентных этапов. Ошибки показаны рядом с полями."); return; }
    const result = await changeProductStatus(product.id, toStatus);
    if (shouldRollbackProductStatus(result)) { setStatusError(result.error ?? "Не удалось сменить статус"); return; }
    setLocalStatus(toStatus);
    toast.success(result.financeState === "PENDING_FX" ? `Статус сохранён: ${productStatusLabels[toStatus]}. Расчёт ожидает курса.` : `Статус: ${productStatusLabels[toStatus]}`);
    if (actorRoles.length === 1 && actorRoles[0] === "ENGINEER" && toStatus === "PRODUCTION") router.replace("/products");
  }
  return <div className="flex min-w-0 flex-wrap items-center gap-2">
    <Badge variant="outline" className={cn("border-transparent", productStatusStyles[localStatus].badge)}>{productStatusLabels[localStatus]}</Badge>
    {statusError ? <p role="alert" className="max-w-full break-words text-sm text-destructive">{statusError}</p> : null}
    {canManage ? <Select value={localStatus} onValueChange={value => { const next = value as ProductStatus | undefined; if (next && next !== localStatus) startTransition(async () => { await moveStatus(next); }); }} disabled={pending}>
      <SelectTrigger className="w-48 max-w-full" aria-label="Сменить статус"><SelectValue>{productStatusLabels[localStatus]}</SelectValue></SelectTrigger>
      <SelectContent>{PRODUCT_STATUSES.map(status => <SelectItem key={status.id} value={status.id}>{status.label}</SelectItem>)}</SelectContent>
    </Select> : null}
    {canEngineerStart ? <div className="flex min-w-0 flex-col gap-1"><Button type="button" variant="outline" className="min-h-12" disabled={pending || !allowedStatusTargets.includes("PRODUCTION")} onClick={() => startTransition(async () => { await moveStatus("PRODUCTION"); })}>Передать в производство</Button>{!allowedStatusTargets.includes("PRODUCTION") ? <span role="note" className="max-w-64 text-xs text-muted-foreground">Для передачи нужна B3D-модель этого изделия или отметка менеджера «Модели нет».</span> : null}</div> : null}
    {canManage && showAmount ? <Button variant="outline" size="sm" onClick={() => { setInitialPrice(product.initialPrice ?? ""); setEditOpen(true); }}><Pencil className="size-4" /> Первоначальная цена</Button> : null}
    {canManage ? <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}><Trash2 className="size-4" /> Удалить</Button> : null}
    <Dialog open={editOpen} onOpenChange={setEditOpen}><DialogContent><DialogHeader><DialogTitle>Первоначальная цена изделия</DialogTitle><DialogDescription>Существующий снимок цены КП, {currency}.</DialogDescription></DialogHeader><div className="flex min-w-0 flex-col gap-1.5"><Label htmlFor="ph-initial-price">Первоначальная цена за 1 шт. (КП), {currency}</Label><Input id="ph-initial-price" type="number" min="0" value={initialPrice} onChange={event => setInitialPrice(event.target.value)} placeholder="не обязательна" /></div><DialogFooter><Button variant="outline" onClick={() => setEditOpen(false)}>Отмена</Button><Button disabled={!initialValid || pending} onClick={() => startTransition(async () => {
      const result = await updateProduct(product.id, {initialPrice: parsedInitialPrice}, {initialPrice: product.initialPrice});
      if (result.ok) { setEditOpen(false); toast.success("Первоначальная цена сохранена"); } else toast.error(result.error ?? "Ошибка сохранения");
    })}>{pending ? "Сохранение…" : "Сохранить"}</Button></DialogFooter></DialogContent></Dialog>
    <ConfirmDeleteDialog entityLabel={`изделие «${product.number} · ${product.title}»`} open={deleteOpen} onOpenChange={setDeleteOpen} warning="Нельзя удалить, пока к изделию привязаны задачи, работы или материалы. Файлы останутся в проекте." onConfirm={async () => {
      const result = await deleteProduct(product.id); if (result.ok) { toast.success("Изделие удалено"); router.push(`/projects/${product.projectId}`); return true; } toast.error(result.error ?? "Ошибка удаления"); return false;
    }} />
  </div>;
}
