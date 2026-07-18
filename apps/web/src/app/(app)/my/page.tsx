import { ClipboardCheck } from "lucide-react"

import { StubPage } from "@/components/stub-page"

export default function Page() {
  return (
    <StubPage
      title="Мои задачи"
      description="Здесь будут ваши задачи и таймер"
      icon={ClipboardCheck}
    />
  )
}
