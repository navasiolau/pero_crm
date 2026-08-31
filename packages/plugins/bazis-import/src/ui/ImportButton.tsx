"use client"

import { useEffect, useState } from "react"
import type { SlotPropsMap } from "@pero/plugin-sdk"

import { fetchImportFiles } from "./api"
import { ImportDialog } from "./ImportDialog"
import { btnOutline } from "./styles"

// Кнопка «Импорт из Базиса» в шапке карточки проекта (слот project.action).
// При монтировании проверяет доступ через files endpoint: роли без права
// импорта (403) кнопку не видят вовсе. Сам список вложений грузит диалог
// при открытии — иначе он устаревает после загрузки страницы.
export default function ImportButton({
  projectId,
}: SlotPropsMap["project.action"]) {
  const [denied, setDenied] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchImportFiles(projectId).then((result) => {
      if (cancelled) return
      if (!result.ok && (result.status === 401 || result.status === 403)) {
        setDenied(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [projectId])

  if (denied) return null

  return (
    <>
      <button
        type="button"
        className={btnOutline}
        onClick={() => setOpen(true)}
      >
        Импорт из Базиса
      </button>
      {open ? (
        <ImportDialog
          projectId={projectId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}
