import Link from "next/link"
import { FolderKanban } from "lucide-react"

import { Button } from "@/components/ui/button"
import { StubPage } from "@/components/stub-page"

export default function Page() {
  return (
    <div className="flex flex-1 flex-col">
      <StubPage title="Проекты" icon={FolderKanban} />
      <div className="-mt-8 flex justify-center">
        <Button variant="outline" render={<Link href="/projects/demo" />}>
          Демо-проект — проверка слотов плагинов
        </Button>
      </div>
    </div>
  )
}
