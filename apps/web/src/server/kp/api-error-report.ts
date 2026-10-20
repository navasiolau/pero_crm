import type { ApiAction } from "./api-contract";

const classes = new Set(["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "URIError", "EvalError", "AggregateError",
  "DatabaseError", "PrismaClientKnownRequestError", "PrismaClientUnknownRequestError", "PrismaClientInitializationError",
  "PrismaClientValidationError", "PrismaClientRustPanicError"]);
const codes = new Set(("P1000 P1001 P1002 P1003 P1008 P1009 P1010 P1011 P1012 P1013 P1014 P1015 P1016 P1017 " +
  "P2000 P2001 P2002 P2003 P2004 P2005 P2006 P2007 P2008 P2009 P2010 P2011 P2012 P2013 P2014 P2015 P2016 P2017 P2018 P2019 " +
  "P2020 P2021 P2022 P2023 P2024 P2025 P2026 P2027 P2028 P2029 P2030 P2031 P2033 P2034 P2035 P2036 P2037 " +
  "EACCES EADDRINUSE EAI_AGAIN ECONNABORTED ECONNREFUSED ECONNRESET EEXIST EHOSTUNREACH EIO EMFILE ENOENT ENOMEM ENOSPC ENOTFOUND EPIPE ETIMEDOUT " +
  "ABORT_ERR ERR_INVALID_ARG_TYPE ERR_INVALID_ARG_VALUE ERR_OUT_OF_RANGE ERR_STREAM_PREMATURE_CLOSE ERR_HTTP_HEADERS_SENT").split(" "));
const sqlStates = new Set(("08000 08001 08003 08004 08006 08007 08P01 22000 22001 22003 22007 22008 22012 22021 22023 " +
  "23000 23502 23503 23505 23514 25000 25P02 40001 40P01 42501 42601 42703 42704 42804 42883 42P01 42P07 " +
  "53300 53400 54000 55000 55P03 57014 57P01 57P02 57P03 58000 XX000").split(" "));
const staticFrames = [
  /^\/app\/(?:apps\/web\/)?\.next\/server\/(?:chunks\/[a-f0-9]+\.js|webpack-runtime\.js|app\/api\/(?:v1\/)?kp\/(?:\[\.\.\.path\]|\[\[\.\.\.path\]\])\/route\.js):\d{1,9}:\d{1,9}$/,
  /^\/app\/packages\/kp-template\/(?:index\.cjs|limits\.cjs|assets\/lib\/(?:contract-docx|kp-browser)\.js|assets\/public\/js\/(?:sheet-render|contract-model)\.js):\d{1,9}:\d{1,9}$/,
  /^node:(?:internal\/[A-Za-z0-9_/-]+|[a-z_]+):\d{1,9}:\d{1,9}$/,
];
const allowed = (value: unknown, whitelist: ReadonlySet<string>) => typeof value === "string" && whitelist.has(value) ? value : undefined;
function frames(stack: unknown): string[] {
  if (typeof stack !== "string") return [];
  // Первая строка и имена функций могут содержать данные; сохраняются только статические пути к коду.
  return stack.slice(0, 16_384).split("\n").slice(1, 40).flatMap(line => {
    const location = /^\s+at (?:.* \()?((?:\/app\/|node:)[^()\s]+:\d+:\d+)\)?$/.exec(line)?.[1];
    return location && staticFrames.some(pattern => pattern.test(location)) ? [location] : [];
  }).slice(0, 5);
}

export function reportKpApiError(error: unknown, action: ApiAction | undefined, surface: "session" | "bearer"): void {
  try {
    const fields = error && typeof error === "object" ? error as Record<string, unknown> : {};
    const meta = fields.meta && typeof fields.meta === "object" ? fields.meta as Record<string, unknown> : {};
    const code = allowed(fields.code, codes) ?? allowed(fields.errorCode, codes);
    const sqlState = [fields.code, fields.sqlState, fields.sqlstate, meta.code, meta.sqlState, meta.sqlstate]
      .map(value => allowed(value, sqlStates)).find(value => value !== undefined);
    console.error("KP_API_UNEXPECTED", { action, surface, errorClass: allowed(fields.name, classes) ?? "UnknownError",
      ...(code ? { code } : {}), ...(sqlState ? { sqlState } : {}), frames: frames(fields.stack) });
  } catch {
    // Ошибка диагностики не должна менять HTTP-ответ или запускать повтор бизнес-операции.
  }
}
