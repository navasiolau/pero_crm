"use client";
import type { ComponentProps, ReactNode } from "react";
import { Tabs, TabsList } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
export function ProjectTabs({ initialTab, children }: { initialTab: string; children: ReactNode }) {
  return <Tabs key={initialTab} defaultValue={initialTab}>{children}</Tabs>;
}

export function ProjectTabsList({ className, ...props }: ComponentProps<typeof TabsList>) {
  // Локально перекрывает мобильный scroll из globals.css, не меняя вкладки остальных страниц.
  return <TabsList className={cn(
    "w-full max-w-full flex-wrap justify-start gap-1 overflow-visible! group-data-horizontal/tabs:h-auto",
    "[&>[data-slot=tabs-trigger]]:h-auto [&>[data-slot=tabs-trigger]]:min-h-8 [&>[data-slot=tabs-trigger]]:min-w-0 [&>[data-slot=tabs-trigger]]:max-w-full [&>[data-slot=tabs-trigger]]:flex-none [&>[data-slot=tabs-trigger]]:whitespace-normal [&>[data-slot=tabs-trigger]]:[overflow-wrap:anywhere]",
    className,
  )} {...props}/>;
}
