import * as React from "react";
import type {ReactNode} from "react";

/** Растёт только номер: прежний размер text-sm/text-xs задаёт его контейнер. */
export function CardNumber({children}:{children:ReactNode}) {
  return <span data-card-number className="text-[1.25em] font-bold">{children}</span>;
}
