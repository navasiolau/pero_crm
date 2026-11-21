import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ComponentProps } from "react";
import type { PageDestination } from "@/lib/page-navigation";

export function PageBackLink({ href, label, onNavigate }: PageDestination & Pick<ComponentProps<typeof Link>, "onNavigate">) {
  return (
    <Link
      href={href}
      replace
      onNavigate={onNavigate}
      aria-label={label}
      data-slot="page-back-link"
      className="inline-flex size-10 shrink-0 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
    </Link>
  );
}
