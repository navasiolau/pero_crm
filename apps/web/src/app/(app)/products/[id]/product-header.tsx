"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { resolveProductReturn } from "@/lib/product-return-navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import type { ProductStatus, ProjectStage, Role } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProductDeleteButton } from "@/components/product-delete-button";
import { useProductInline } from "@/components/product-inline-provider";
import { PRODUCT_STATUSES, productStatusLabels, productStatusStyles } from "@/lib/product-statuses";
import { cn } from "@/lib/utils";
import { currentProductStatusTargets, shouldRollbackProductStatus } from "@/lib/product-percentage-ui";
import { changeProductStatus } from "@/server/products/actions";

export function ProductHeader({
  product,
  canManage,
  actorRoles,
  actorUserId,
  backHref,
}: {
  product: {
    id: string;
    number: string;
    title: string;
    kind: string | null;
    status: ProductStatus;
    expectedPrice: string | null;
    quantity: number;
    description: string | null;
    projectId: string;
    projectStage?: ProjectStage;
    engineerId: string | null;
  };
  currency: string;
  canManage: boolean;
  showAmount: boolean;
  actorRoles: readonly Role[];
  actorUserId?: string;
  backHref?: string;
  hasB3d?: boolean;
  noModel?: boolean;
  isEngineeringParticipant?: boolean;
}) {
  const router = useRouter();
  const inline = useProductInline();
  const [pending, startTransition] = useTransition();
  const [localStatus, setLocalStatus] = useState(product.status);
  const [statusError, setStatusError] = useState<string | null>(null);
  const allowedStatusTargets = currentProductStatusTargets(actorRoles, { ...product, status: localStatus }, actorUserId);
  const engineerTarget = allowedStatusTargets[0];
  const canEngineerMove = !canManage && actorRoles.includes("ENGINEER") && !!engineerTarget;
  async function moveStatus(toStatus: ProductStatus) {
    setStatusError(null);
    if (!await inline.flush()) { setStatusError("Сначала сохраните цену, количество, инженера и настройки процентных этапов. Ошибки показаны рядом с полями."); return; }
    const result = await changeProductStatus(product.id, toStatus);
    if (shouldRollbackProductStatus(result)) { setStatusError(result.error ?? "Не удалось сменить статус"); return; }
    setLocalStatus(toStatus);
    toast.success(result.financeState === "PENDING_FX" ? `Статус сохранён: ${productStatusLabels[toStatus]}. Расчёт ожидает курса.` : `Статус: ${productStatusLabels[toStatus]}`);
    router.refresh();
  }
  const returnDestination = resolveProductReturn(backHref, product.projectId);
  return <div className="flex min-w-0 flex-wrap items-start gap-2">
    <div className="flex min-w-0 flex-wrap items-center gap-2">
    <Link href={returnDestination.href} aria-label={returnDestination.label} className="inline-flex size-10 shrink-0 items-center justify-center rounded-md hover:bg-muted"><ArrowLeft className="size-4" /></Link>
    <span className="shrink-0 text-sm text-muted-foreground">{product.number}</span>
    <Badge variant="outline" className={cn("border-transparent", productStatusStyles[localStatus].badge)}>{productStatusLabels[localStatus]}</Badge>
    </div>
    <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
    {statusError ? <p role="alert" className="max-w-full break-words text-sm text-destructive">{statusError}</p> : null}
    {canManage ? <Select value={localStatus} onValueChange={value => { const next = value as ProductStatus | undefined; if (next && next !== localStatus) startTransition(async () => { await moveStatus(next); }); }} disabled={pending || allowedStatusTargets.length === 0}>
      <SelectTrigger className="w-48 max-w-full" aria-label="Сменить статус"><SelectValue>{productStatusLabels[localStatus]}</SelectValue></SelectTrigger>
      <SelectContent>{PRODUCT_STATUSES.filter(status => status.id === localStatus || allowedStatusTargets.includes(status.id)).map(status => <SelectItem key={status.id} value={status.id}>{status.label}</SelectItem>)}</SelectContent>
    </Select> : null}
    {canEngineerMove ? <Button type="button" variant="outline" className="min-h-12" disabled={pending} onClick={() => startTransition(async () => { await moveStatus(engineerTarget); })}>{engineerTarget === "DESIGN" ? "Вернуть в проектирование" : "Передать в производство"}</Button> : null}
    <ProductDeleteButton productId={product.id} canManage={canManage} returnHref={returnDestination.href} />
    </div>
  </div>;
}
