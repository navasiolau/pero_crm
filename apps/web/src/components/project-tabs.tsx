"use client";
import type { ReactNode } from "react";
import { Tabs } from "@/components/ui/tabs";
export function ProjectTabs({ initialTab, children }: { initialTab: string; children: ReactNode }) {
  return <Tabs key={initialTab} defaultValue={initialTab}>{children}</Tabs>;
}
