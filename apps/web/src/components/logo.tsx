import { cn } from "@/lib/utils"

// Фирменный знак PERO — перо (как в CRM v1), без подложки.
// Цвет — currentColor: наследует цвет текста, виден в обеих темах.
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("size-8 shrink-0", className)}
      role="img"
      aria-label="PERO"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z" />
      <path d="M16 8 2 22" />
      <path d="M17.5 15H9" />
    </svg>
  )
}
