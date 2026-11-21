"use client";

import type { ReactNode } from "react";
import type { PageDestination } from "@/lib/page-navigation";
import { cn } from "@/lib/utils";
import { PageBackLink } from "./page-back-link";
import { usePageBack } from "./page-navigation-provider";

type PageHeaderProps = {
  title: ReactNode;
  titleId?: string;
  titleClassName?: string;
  description?: ReactNode;
  actions?: ReactNode;
  back?: PageDestination;
};

export function PageHeader({ title, titleId, titleClassName, description, actions, back }: PageHeaderProps) {
  const { destination, goBack } = usePageBack(back);
  return (
    <header data-slot="page-header" className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className={cn("grid min-w-0 max-w-full grid-cols-1 items-center gap-x-2", destination && "grid-cols-[auto_minmax(0,1fr)]")}>
        {destination && <PageBackLink {...destination} onNavigate={event => goBack?.(destination.href, event)} />}
        {typeof title === "string" ? (
          <h1 id={titleId} className={cn("min-w-0 wrap-anywhere text-2xl font-semibold", titleClassName)}>{title}</h1>
        ) : <div className={cn("min-w-0", titleClassName)}>{title}</div>}
        {description && <div className="col-end-[-1] row-start-2 min-w-0 text-sm text-muted-foreground">{description}</div>}
      </div>
      {actions && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
