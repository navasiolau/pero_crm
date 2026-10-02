"use client";

import { useMemo, useState, useEffect, useRef, useLayoutEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useOptionalProductInline } from "@/components/product-inline-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { projectedPercentagePrice, projectedPercentageTotal, canRebaseSuggestedParticipants } from "@/lib/inline-percentage-projection";
import { formatAmount } from "@/lib/format";
import { assertPercentageShares, parsePercentageRate } from "@/lib/product-percentage-pay";
import type { ProductPercentageKind } from "@/lib/product-percentage-pay";
import type {
  ProductPercentageSectionView,
  ProductPercentageView,
} from "@/lib/product-percentage-view";
import {
  initialProductPercentageParticipants,
  addProductPercentageParticipant,
  canEditProductPercentageConfig,
  percentageTextToShareUnits,
  previewProductPercentageShare,
  needsInstallationLegacyReview,
  installationLegacyReviewSatisfied,
  displayProductPercentageMemberAmount,
  shareUnitsToPercentageText,
  toggleInstallationWorkSelection,
  transferOptionsForKind,
  type ProductPercentageCandidate,
} from "@/lib/product-percentage-ui";
import {
  configureProductPercentageAction,
  retryProductPercentageAction,
  setProductNoModelAction,
  transferProductPercentageShareAction,
} from "@/server/product-percentage-pay/actions";

const noSubscribe = () => () => {};

const stageTitle: Record<ProductPercentageKind, string> = {
  ENGINEERING: "Инженерный этап",
  INSTALLATION: "Монтажный этап",
};
const stateTitle: Record<ProductPercentageSectionView["state"], string> = {
  DRAFT: "Настройка",
  SKIPPED_ONCE: "Пропущено при первом завершении",
  PENDING_FX: "Ожидает курса",
  SETTLED: "Зафиксировано",
  LEGACY_PROTECTED: "Сохранена прежняя история",
};

export function ProductPercentagePanel({
  view,
  assignedEngineerId,
  canManage,
  canViewAll,
  engineers,
  mounters,
}: {
  view: ProductPercentageView;
  assignedEngineerId: string | null;
  canManage: boolean;
  canViewAll: boolean;
  engineers: ProductPercentageCandidate[];
  mounters: ProductPercentageCandidate[];
}) {
  const router = useRouter();
  const [noModelBusy, setNoModelBusy] = useState(false);
  const inline = useOptionalProductInline();
  const engineerController = inline?.controller("engineerId");
  const acknowledgedEngineer = useSyncExternalStore(engineerController?.subscribe ?? noSubscribe, () => engineerController ? engineerController.getSnapshot().baseline : assignedEngineerId, () => engineerController ? engineerController.getServerSnapshot().baseline : assignedEngineerId);
  const currentEngineerId = acknowledgedEngineer === null ? null : String(acknowledgedEngineer);
  useEffect(() => {
    if (inline) inline.registerGuard("percentage-no-model", async () => !noModelBusy);
    // Сохраняем последний dirty/pending guard скрытой вкладки; открытие заменяет его.
  }, [inline, noModelBusy]);
  const candidates: Record<ProductPercentageKind, ProductPercentageCandidate[]> = {
    ENGINEERING: engineers,
    INSTALLATION: mounters,
  };

  async function setNoModel(noModel: boolean) {
    if (noModelBusy) return;
    setNoModelBusy(true);
    try {
      const result = await setProductNoModelAction({ productId: view.productId, noModel });
      if (!result.ok) throw new Error(result.error);
      toast.success(noModel ? "Отметка сохранена" : "Отметка снята");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить отметку");
    } finally {
      setNoModelBusy(false);
    }
  }

  return (
    <section className="min-w-0 space-y-4" aria-label="Процентные этапы изделия">
      {canManage ? (
        <Card className="min-w-0">
          <CardContent className="flex min-h-12 items-start gap-3 p-4">
            <Checkbox
              id="product-no-model"
              checked={view.noModel}
              disabled={noModelBusy}
              onCheckedChange={(checked) => {
                if (typeof checked === "boolean") void setNoModel(checked);
              }}
            />
            <div className="min-w-0 space-y-1">
              <Label htmlFor="product-no-model" className="min-h-6 cursor-pointer text-sm">
                Модели нет
              </Label>
              <p className="text-xs text-muted-foreground">
                Инженер сможет вручную перевести изделие из проектирования в производство.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {(["ENGINEERING", "INSTALLATION"] as const).map((kind) => (
          <PercentageStageSection
            key={`${view.productId}:${kind}:${view.sections[kind].revision}:${view.sections[kind].state}`}
            productId={view.productId}
            kind={kind}
            section={view.sections[kind]}
            assignedEngineerId={currentEngineerId}
            canManage={canManage}
            canViewAll={canViewAll}
            candidates={candidates[kind]}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Процентные начисления фиксируются отдельно от сдельных работ. Здесь нет выдачи денег или просмотра чужой зарплаты.
      </p>
    </section>
  );
}

function PercentageStageSection({
  productId,
  kind,
  section,
  assignedEngineerId,
  canManage,
  canViewAll,
  candidates,
}: {
  productId: string;
  kind: ProductPercentageKind;
  section: ProductPercentageSectionView;
  assignedEngineerId: string | null;
  canManage: boolean;
  canViewAll: boolean;
  candidates: ProductPercentageCandidate[];
}) {
  const router = useRouter();
  const initial = useMemo(
    () => initialProductPercentageParticipants(kind, section, assignedEngineerId),
    [assignedEngineerId, kind, section],
  );
  const previousInitial = useRef(initial);
  const [rate, setRate] = useState(section.ratePercent ?? "");
  const [participants, setParticipants] = useState(initial);
  const [shares, setShares] = useState<Record<string, string>>(
    () => Object.fromEntries(initial.map((row) => [row.userId, shareUnitsToPercentageText(row.shareUnits)])),
  );
  const [addUserId, setAddUserId] = useState("");
  const [installationWorkIds, setInstallationWorkIds] = useState<string[]>([]);
  const [reviewedLegacyWorks, setReviewedLegacyWorks] = useState(false);
  const [transferUserId, setTransferUserId] = useState("");
  const [transferPercent, setTransferPercent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inline = useOptionalProductInline();
  const priceController = inline?.controller("expectedPrice");
  const acknowledgedPrice = useSyncExternalStore(priceController?.subscribe ?? noSubscribe, () => priceController ? priceController.getSnapshot().baseline : section.price, () => priceController ? priceController.getServerSnapshot().baseline : section.price);
  const displayPrice = projectedPercentagePrice(section.state, section.price, priceController && canViewAll ? acknowledgedPrice === null ? null : String(acknowledgedPrice) : undefined);
  useLayoutEffect(() => {
    if (canRebaseSuggestedParticipants({ state: section.state, hasConfiguration: section.hasConfiguration, previous: previousInitial.current, next: initial, participants, shares,
      otherDirty: rate !== (section.ratePercent ?? "") || Boolean(installationWorkIds.length || reviewedLegacyWorks || addUserId || transferUserId || transferPercent) })) {
      setParticipants(initial);
      setShares(Object.fromEntries(initial.map(row => [row.userId, shareUnitsToPercentageText(row.shareUnits)])));
    }
    previousInitial.current = initial;
  }, [initial, section.state, section.hasConfiguration, section.ratePercent, participants, shares, rate, installationWorkIds.length, reviewedLegacyWorks, addUserId, transferUserId, transferPercent]);


  const shareRows = useMemo(() => participants.map((row) => {
    try {
      return { userId: row.userId, shareUnits: percentageTextToShareUnits(shares[row.userId] ?? "") };
    } catch {
      return row;
    }
  }), [participants, shares]);
  const sharesValid = (() => {
    try {
      assertPercentageShares(participants.map((row) => ({ userId: row.userId, shareUnits: percentageTextToShareUnits(shares[row.userId] ?? "") })));
      return true;
    } catch {
      return false;
    }
  })();
  const normalizedRate = (() => {
    try {
      return parsePercentageRate(rate.trim() ? rate.trim().replace(",", ".") : null);
    } catch {
      return undefined;
    }
  })();
  const managerCanEdit = canEditProductPercentageConfig({
    canManage,
    sectionCanManage: section.canManage,
    state: section.state,
  });
  const configDirty = managerCanEdit && (
    rate !== (section.ratePercent ?? "") ||
    JSON.stringify(participants) !== JSON.stringify(initial) ||
    JSON.stringify(shares) !== JSON.stringify(Object.fromEntries(initial.map(row => [row.userId, shareUnitsToPercentageText(row.shareUnits)]))) ||
    installationWorkIds.length > 0 || reviewedLegacyWorks || Boolean(addUserId || transferUserId || transferPercent)
  );
  useEffect(() => {
    if (inline) inline.registerGuard(`percentage-${kind}`, async () => !busy && !error && !configDirty);
    // Guard остаётся при смене вкладки: скрытый черновик не должен
    // разрешать финансовый переход статуса.
  }, [inline, kind, busy, error, configDirty]);
  const installationReviewRequired = needsInstallationLegacyReview(kind, section.requiresManagerReview);
  const reviewAcknowledged = installationLegacyReviewSatisfied(installationReviewRequired, reviewedLegacyWorks);
  const activeRows = section.state === "SETTLED" || section.state === "PENDING_FX" ? section.members : shareRows;
  const people = new Map(candidates.map((person) => [person.id, person.name]));
  const participantNames = new Map(section.members.map((person) => [person.userId, person.name]));
  const transferChoices = section.transferCandidates.map((candidate) => ({ value: candidate.userId, label: candidate.name }));
  const addChoices = transferOptionsForKind(kind, candidates, "")
    .filter((option) => !participants.some((member) => member.userId === option.value));
  const previewRate = normalizedRate === undefined ? null : normalizedRate;
  const displayTotal = projectedPercentageTotal(section.state, section.total, displayPrice, previewRate);

  async function perform(operation: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await operation();
      if (!result.ok) throw new Error(result.error ?? "Не удалось сохранить настройки");
      toast.success(success);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить настройки");
    } finally {
      setBusy(false);
    }
  }

  function addParticipant(userId: string) {
    if (!userId || participants.some((row) => row.userId === userId)) return;
    const next = addProductPercentageParticipant(participants, userId);
    const added = next.find((row) => row.userId === userId)!;
    setParticipants(next);
    setShares((rows) => ({ ...rows, [userId]: shareUnitsToPercentageText(added.shareUnits) }));
    setAddUserId("");
  }

  function removeParticipant(userId: string) {
    setParticipants((rows) => rows.filter((row) => row.userId !== userId));
    setShares((rows) => {
      const next = { ...rows };
      delete next[userId];
      return next;
    });
  }

  function saveConfiguration() {
    try {
      if (!reviewAcknowledged) throw new Error("Подтвердите проверку источников оплаты существующих работ");
      const cleanRate = parsePercentageRate(rate.trim() ? rate.trim().replace(",", ".") : null);
      const configuredShares = participants.map((row) => ({
        userId: row.userId,
        shareUnits: percentageTextToShareUnits(shares[row.userId] ?? ""),
      }));
      assertPercentageShares(configuredShares);
      void perform(() => configureProductPercentageAction({
        productId,
        kind,
        ratePercent: cleanRate,
        participants: configuredShares,
        expectedRevision: section.revision,
        ...(kind === "INSTALLATION" && installationWorkIds.length ? { installationWorkIds } : {}),
        ...(installationReviewRequired ? { reviewedLegacyWorks: reviewedLegacyWorks } : {}),
      }), "Настройки этапа сохранены");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Проверьте ставку и доли");
    }
  }

  function transferShare() {
    if (!transferUserId || !transferPercent.trim()) {
      setError("Выберите коллегу и укажите часть своей доли");
      return;
    }
    try {
      parsePercentageRate(transferPercent.trim().replace(",", "."));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Проверьте долю");
      return;
    }
    void perform(() => transferProductPercentageShareAction({
      productId,
      kind,
      toUserId: transferUserId,
      percentOfOwnShare: transferPercent.trim().replace(",", "."),
      expectedRevision: section.revision,
    }), "Ваша доля передана коллеге");
  }

  async function retryFx() {
    await perform(() => retryProductPercentageAction({ productId, kind }), "Расчёт обновлён");
  }

  const displayedRows = canViewAll ? activeRows : section.ownMember ? [section.ownMember] : [];

  return (
    <Card className="min-w-0">
      <CardHeader className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base">{stageTitle[kind]}</CardTitle>
            <CardDescription>{stateTitle[section.state]}</CardDescription>
          </div>
          {section.state === "PENDING_FX" && canManage ? (
            <Button type="button" variant="outline" className="min-h-12" disabled={busy} onClick={() => void retryFx()}>
              <RotateCcw /> Повторить расчёт
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        {error ? <p role="alert" className="break-words rounded-md border border-destructive/50 p-3 text-sm text-destructive">{error}</p> : null}
        {canViewAll ? (
          <div className="grid min-w-0 gap-2 text-sm sm:grid-cols-2">
            <p>Цена изделия: {displayPrice === null ? "не задана" : formatAmount(displayPrice, section.productCurrency)}</p>
            <p>Валюта зарплаты: {section.payrollCurrency ?? "будет зафиксирована при начислении"}</p>
          </div>
        ) : null}
        <div className="space-y-2">
          {displayedRows.length ? displayedRows.map((row) => {
            const rowName = (row as { name?: unknown }).name;
            const name = participantNames.get(row.userId) ?? people.get(row.userId) ?? (typeof rowName === "string" ? rowName : null) ?? "Участник";
            const preview = previewProductPercentageShare(displayPrice, previewRate, row.shareUnits);
            const rowAmount = (row as { amount?: unknown }).amount;
            const savedAmount = typeof rowAmount === "string" ? rowAmount : null;
            const amount = displayProductPercentageMemberAmount(section.state, savedAmount, preview);
            const currency = section.state === "SETTLED" ? section.payrollCurrency ?? section.productCurrency : section.productCurrency;
            return (
              <div key={row.userId} className="flex min-w-0 flex-col gap-1 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 break-words">
                  <p className="font-medium">{section.ownMember?.userId === row.userId && !canManage ? "Ваша доля" : name}</p>
                  <p className="text-sm text-muted-foreground">Доля {shareUnitsToPercentageText(row.shareUnits)}%{!section.canManage && section.ratePercent !== null ? ` · ставка ${section.ratePercent}%` : ""}</p>
                </div>
                {amount !== null ? (
                  <p className="shrink-0 font-medium">{section.state === "DRAFT" ? "≈ " : ""}{formatAmount(amount, currency)}</p>
                ) : null}
                {managerCanEdit ? (
                  <div className="flex min-w-0 items-end gap-2 sm:w-40">
                    <div className="min-w-0 flex-1">
                      <Label htmlFor={`${kind}-${row.userId}-share`}>Доля, %</Label>
                      <Input
                        id={`${kind}-${row.userId}-share`}
                        className="h-12"
                        inputMode="decimal"
                        value={shares[row.userId] ?? ""}
                        onChange={(event) => setShares((rows) => ({ ...rows, [row.userId]: event.target.value }))}
                        disabled={busy}
                      />
                    </div>
                    <Button type="button" variant="outline" className="size-12 shrink-0" aria-label={`Убрать ${name}`} disabled={busy} onClick={() => removeParticipant(row.userId)}>
                      <Trash2 />
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          }) : (
            <p className="text-sm text-muted-foreground">Участники этапа пока не назначены.</p>
          )}
        </div>

        {managerCanEdit ? (
          <div className="space-y-4 rounded-lg border p-3 sm:p-4">
            <div className="space-y-1.5">
              <Label htmlFor={`${kind}-rate`}>Общая ставка роли, %</Label>
              <Input
                id={`${kind}-rate`}
                className="h-12"
                inputMode="decimal"
                value={rate}
                onChange={(event) => setRate(event.target.value)}
                placeholder="не задана"
                disabled={busy}
              />
              <p className="text-xs text-muted-foreground">Цена изделия × ставка роли × доля участника. Оставьте пустым, чтобы не задавать ставку.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Добавить участника</Label>
              <SearchableSelect
                options={addChoices}
                value={addUserId}
                onChange={addParticipant}
                placeholder="Выберите активного коллегу"
                searchPlaceholder="Поиск сотрудника…"
                className="min-h-12"
                disabled={busy || addChoices.length === 0}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {shareRows.map((row) => (
                <p key={row.userId} className="text-sm text-muted-foreground">
                  {people.get(row.userId) ?? participantNames.get(row.userId) ?? "Участник"}: {shareUnitsToPercentageText(row.shareUnits)}%
                  {section.state === "DRAFT" && previewProductPercentageShare(displayPrice, previewRate, row.shareUnits) !== null
                    ? ` · ≈ ${formatAmount(previewProductPercentageShare(displayPrice, previewRate, row.shareUnits), section.productCurrency)}`
                    : ""}
                </p>
              ))}
            </div>
            {kind === "INSTALLATION" && (section.installationWorkCandidates.length > 0 || section.classifiedInstallationWorkIds.length > 0 || installationReviewRequired) ? (
              <div className="space-y-3 rounded-md border p-3">
                <div>
                  <h4 className="font-medium">Существующие работы для источника INSTALLATION</h4>
                  <p className="text-xs text-muted-foreground">
                    Отмеченные работы оплачиваются процентом; остальные сохраняют сдельную оплату. Это только выбор источника — отдельный фонд, веса и проценты на Work не создаются.
                  </p>
                </div>
                {installationReviewRequired ? (
                  <label className="flex min-h-12 items-start gap-3 rounded-md border p-3 text-sm">
                    <Checkbox
                      checked={reviewedLegacyWorks}
                      disabled={busy}
                      onCheckedChange={(checked) => setReviewedLegacyWorks(checked === true)}
                    />
                    <span>Источники оплаты существующих работ проверены</span>
                  </label>
                ) : null}
                {section.classifiedInstallationWorkIds.length ? (
                  <p className="text-sm">Уже отмечено работ: {section.classifiedInstallationWorkIds.length}.</p>
                ) : null}
                {section.installationWorkCandidates.length ? (
                  <div className="space-y-2">
                    {section.installationWorkCandidates.map((work) => (
                      <label key={work.id} className="flex min-h-12 items-start gap-3 rounded-md border p-3 text-sm">
                        <Checkbox
                          checked={installationWorkIds.includes(work.id)}
                          disabled={busy || !work.canConvert}
                          onCheckedChange={(checked) => setInstallationWorkIds((current) =>
                            toggleInstallationWorkSelection(current, work.id, checked === true, work.canConvert))}
                        />
                        <span className="min-w-0 break-words">
                          <span className="block font-medium">{work.title}</span>
                          {work.reason ? <span className="block text-xs text-muted-foreground">{work.reason}</span> : null}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Нет подходящих неоплаченных сдельных работ.</p>
                )}
              </div>
            ) : null}
            {normalizedRate === undefined ? <p role="alert" className="text-sm text-destructive">Ставка должна быть от 0 до 100 процентов</p> : null}
            {!sharesValid ? <p className="text-sm text-muted-foreground">Доли всех участников должны составлять ровно 100%.</p> : null}
            <Button type="button" className="min-h-12 w-full sm:w-auto" disabled={busy || !sharesValid || normalizedRate === undefined || !participants.length || !reviewAcknowledged} onClick={saveConfiguration}>
              Сохранить настройки этапа
            </Button>
          </div>
        ) : null}

        {section.canTransfer && section.ownMember && section.state === "DRAFT" ? (
          <div className="space-y-3 rounded-lg border p-3 sm:p-4">
            <div>
              <h4 className="font-medium">Передать часть своей доли</h4>
              <p className="text-sm text-muted-foreground">Можно добавить активного коллегу той же роли до завершения этапа.</p>
            </div>
            <SearchableSelect
              options={transferChoices}
              value={transferUserId}
              onChange={setTransferUserId}
              placeholder="Выберите активного коллегу"
              searchPlaceholder="Поиск сотрудника…"
              className="min-h-12"
              disabled={busy || transferChoices.length === 0}
            />
            <div className="space-y-1.5">
              <Label htmlFor={`${kind}-transfer-percent`}>Часть вашей доли для передачи, %</Label>
              <Input
                id={`${kind}-transfer-percent`}
                className="h-12"
                inputMode="decimal"
                value={transferPercent}
                onChange={(event) => setTransferPercent(event.target.value)}
                placeholder="например, 30"
                disabled={busy}
              />
            </div>
            <Button type="button" variant="outline" className="min-h-12 w-full sm:w-auto" disabled={busy || !transferUserId || !transferPercent.trim()} onClick={transferShare}>
              <ArrowRightLeft /> Передать долю
            </Button>
          </div>
        ) : null}

        {section.state === "DRAFT" && displayPrice === null && canViewAll ? (
          <p className="text-sm text-muted-foreground">Задайте цену изделия, чтобы увидеть предварительную сумму.</p>
        ) : null}
        {section.state === "SKIPPED_ONCE" ? (
          <>
            <p className="rounded-md border p-3 text-sm text-muted-foreground">При первом завершении этап был пропущен без начисления. Поздняя настройка сохраняется только для истории и не создаёт оплату задним числом или при повторном переходе.</p>
            {canViewAll && section.skippedSnapshot ? (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <p className="font-medium">Неизменяемый снимок первого завершения</p>
                <p>Дата: {new Date(section.skippedSnapshot.completedAt).toLocaleDateString("ru-RU")}</p>
                <p>Цена: {section.skippedSnapshot.price === null ? "не задана" : formatAmount(section.skippedSnapshot.price, section.skippedSnapshot.productCurrency)}</p>
                <p>Ставка: {section.skippedSnapshot.ratePercent === null ? "не задана" : `${section.skippedSnapshot.ratePercent}%`}</p>
                {section.skippedSnapshot.members.length ? (
                  <ul className="mt-1 list-inside list-disc">
                    {section.skippedSnapshot.members.map((member) => (
                      <li key={member.userId}>{member.name} — {shareUnitsToPercentageText(member.shareUnits)}%</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
        {section.state === "PENDING_FX" ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">Статус изделия сохранён. Расчёт ожидает доступности валютного курса.</p>
        ) : null}
        {section.legacyPaidSummary ? (
          <div className="rounded-md border p-3 text-sm">
            <p className="font-medium">Прежнее начисление, только история</p>
            <p>{section.legacyPaidSummary.count} записей · {formatAmount(section.legacyPaidSummary.amount, section.legacyPaidSummary.currency)}</p>
          </div>
        ) : null}
        {section.state === "SETTLED" && section.total !== null && canManage ? (
          <p className="rounded-md border bg-muted/30 p-3 text-sm font-medium">Начислено всего: {formatAmount(section.total, section.payrollCurrency ?? section.productCurrency)}</p>
        ) : null}
        {section.state === "DRAFT" && displayTotal !== null && canViewAll ? (
          <p className="rounded-md border bg-muted/30 p-3 text-sm font-medium">Предварительно по этапу: ≈ {formatAmount(displayTotal, section.productCurrency)}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
