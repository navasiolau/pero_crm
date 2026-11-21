import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export function PageBackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      data-slot="page-back-link"
      className="inline-flex size-10 shrink-0 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
    </Link>
  );
}
