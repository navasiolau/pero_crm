import type {ReactNode} from "react";
import {Card, CardContent} from "@/components/ui/card";

export function FileGroupPanel({header, actions, feedback, children}: {
  header: ReactNode;
  actions?: ReactNode;
  feedback?: ReactNode;
  children?: ReactNode;
}) {
  return <Card data-file-group-panel className="min-w-0 gap-0 border py-0 ring-0">
    <CardContent className="flex min-w-0 flex-col gap-3 p-4">
      <header data-file-group-header className="flex min-w-0 items-center justify-between gap-3">
        {header}
        {actions ? <div data-file-group-upload className="shrink-0">{actions}</div> : null}
      </header>
      {feedback}
      <div data-file-group-body className="flex min-w-0 flex-col gap-2">{children}</div>
    </CardContent>
  </Card>;
}
