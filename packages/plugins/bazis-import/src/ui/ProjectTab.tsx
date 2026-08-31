"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import type { SlotPropsMap } from "@pero/plugin-sdk"
import { toast } from "sonner"

import type { ImportBatchItem } from "./api"
import { fetchImportBatches, fetchImportFiles, postRevert } from "./api"
import { ImportDialog } from "./ImportDialog"
import { plural } from "./plural"
import {
  btnDestructiveSm,
  btnGhostSm,
  btnOutline,
  btnPrimary,
} from "./styles"

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU")
}

// Вкладка «Данные Базиса» в карточке проекта (слот project.tab):
// запуск импорта + история пакетов с откатом.
export default function ProjectTab({
  projectId,
}: SlotPropsMap["project.tab"]) {
  const router = useRouter()
  const [batches, setBatches] = useState<ImportBatchItem[] | null>(null)
  const [denied, setDenied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [revertTarget, setRevertTarget] = useState<ImportBatchItem | null>(null)
  const [revertBusy, setRevertBusy] = useState(false)

  const load = useCallback(async () => {
    // files endpoint здесь нужен только для проверки прав (403 → заглушка);
    // список вложений для диалога грузится самим диалогом при открытии.
    const [batchesResult, filesResult] = await Promise.all([
      fetchImportBatches(projectId),
      fetchImportFiles(projectId),
    ])
    if (
      (!batchesResult.ok && (batchesResult.status === 401 || batchesResult.status === 403)) ||
      (!filesResult.ok && (filesResult.status === 401 || filesResult.status === 403))
    ) {
      setDenied(true)
      return
    }
    if (batchesResult.ok) setBatches(batchesResult.batches)
    else setError(batchesResult.error)
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  async function revert(batch: ImportBatchItem) {
    setRevertBusy(true)
    setError(null)
    try {
      const result = await postRevert(batch.id)
      if (!result.ok) {
        // Диалог закрываем, чтобы был виден alert-блок с причинами (409).
        setRevertTarget(null)
        setError(result.error)
        toast.error(result.error)
        return
      }
      toast.success("Импорт откачен, изделия удалены")
      setRevertTarget(null)
      await load()
      router.refresh()
    } finally {
      setRevertBusy(false)
    }
  }

  if (denied) {
    return (
      <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        Недостаточно прав для просмотра импортов из Базис-Мебельщик.
      </div>
    )
  }

  return (
    <div className="rounded-xl border bg-card p-4 text-card-foreground">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium">Импорты из Базис-Мебельщик</h3>
        <button
          type="button"
          className={btnPrimary}
          onClick={() => setImportOpen(true)}
        >
          Импортировать XML
        </button>
      </div>

      {error ? (
        <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {batches === null ? (
        <p className="mt-4 text-sm text-muted-foreground">Загрузка…</p>
      ) : batches.length === 0 ? (
        <div className="mt-4 flex flex-col items-start gap-3 rounded-lg border border-dashed p-6">
          <p className="text-sm text-muted-foreground">
            Импортов пока не было.
          </p>
          <button
            type="button"
            className={btnOutline}
            onClick={() => setImportOpen(true)}
          >
            Импортировать XML
          </button>
        </div>
      ) : (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-2 py-1 font-medium">Дата</th>
              <th className="px-2 py-1 font-medium">Файл</th>
              <th className="px-2 py-1 font-medium">Изделий</th>
              <th className="px-2 py-1 font-medium">Импортировал</th>
              <th className="px-2 py-1 font-medium">Статус</th>
              <th className="px-2 py-1 font-medium" aria-label="Действия" />
            </tr>
          </thead>
          <tbody>
            {batches.map((batch) => (
              <tr key={batch.id} className="border-b last:border-0">
                <td className="px-2 py-1 whitespace-nowrap">
                  {formatDateTime(batch.createdAt)}
                </td>
                <td className="max-w-56 truncate px-2 py-1">
                  {batch.fileName ?? "—"}
                </td>
                <td className="px-2 py-1 whitespace-nowrap">
                  {batch.productsCount}
                  {batch.draftProductsCount > batch.productsCount
                    ? ` из ${batch.draftProductsCount}`
                    : ""}
                </td>
                <td className="px-2 py-1">{batch.createdByName ?? "—"}</td>
                <td className="px-2 py-1 whitespace-nowrap">
                  {batch.revertedAt ? (
                    <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                      Откачен {formatDateTime(batch.revertedAt)}
                    </span>
                  ) : (
                    <span className="rounded-full border border-green-500/40 bg-green-500/10 px-2 py-0.5 text-xs text-green-700 dark:text-green-400">
                      Активен
                    </span>
                  )}
                </td>
                <td className="px-2 py-1 text-right">
                  {!batch.revertedAt ? (
                    <button
                      type="button"
                      className={btnDestructiveSm}
                      onClick={() => setRevertTarget(batch)}
                    >
                      Откатить
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {importOpen ? (
        <ImportDialog
          projectId={projectId}
          onClose={() => {
            setImportOpen(false)
            void load()
          }}
        />
      ) : null}

      {revertTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={revertBusy ? undefined : () => setRevertTarget(null)}
          />
          <div className="relative z-10 w-full max-w-md rounded-xl border bg-card p-6 text-card-foreground shadow-lg">
            <h3 className="text-lg font-semibold">Откатить импорт?</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {plural(revertTarget.productsCount, "Будет удалено", "Будут удалены", "Будут удалены")}{" "}
              {revertTarget.productsCount}{" "}
              {plural(revertTarget.productsCount, "изделие", "изделия", "изделий")},{" "}
              {plural(revertTarget.productsCount, "созданное", "созданных", "созданных")}{" "}
              импортом{revertTarget.fileName ? ` из «${revertTarget.fileName}»` : ""}
              . Если по ним уже есть задачи, работы или материалы — откат
              будет отклонён.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className={btnOutline}
                onClick={() => setRevertTarget(null)}
                disabled={revertBusy}
              >
                Отмена
              </button>
              <button
                type="button"
                className={btnDestructiveSm}
                onClick={() => void revert(revertTarget)}
                disabled={revertBusy}
              >
                {revertBusy ? "Откатываем…" : "Откатить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
