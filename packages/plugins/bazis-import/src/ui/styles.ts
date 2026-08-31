// Классы кнопок повторяют начертание apps/web/src/components/ui/button.tsx
// (shadcn base-nova), т.к. алиас "@/components" пакету недоступен.

const BUTTON_BASE =
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border text-sm font-medium whitespace-nowrap transition-all select-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"

/** variant=default, size=default. */
export const btnPrimary = `${BUTTON_BASE} h-8 border-transparent bg-primary px-2.5 text-primary-foreground hover:bg-primary/80`

/** variant=outline, size=default. */
export const btnOutline = `${BUTTON_BASE} h-8 border-border bg-background px-2.5 hover:bg-muted hover:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50`

/** variant=destructive, size=sm. */
export const btnDestructiveSm = `${BUTTON_BASE} h-7 rounded-[min(var(--radius-md),12px)] border-transparent bg-destructive/10 px-2.5 text-[0.8rem] text-destructive hover:bg-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30`

/** variant=ghost, size=sm (второстепенные действия в таблицах). */
export const btnGhostSm = `${BUTTON_BASE} h-7 rounded-[min(var(--radius-md),12px)] border-transparent px-2.5 text-[0.8rem] hover:bg-muted hover:text-foreground dark:hover:bg-muted/50`

/** Поле ввода (начертание apps/web input). */
export const inputCls =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
