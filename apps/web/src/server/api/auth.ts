import { NextResponse } from "next/server";

import { hasScope, verifyApiToken, type VerifiedToken } from "@/server/plugins/tokens";

// Авторизация REST API /api/v1: Bearer-токен + проверка scope.
// Возвращает токен или готовый NextResponse с ошибкой.
export async function authenticate(
  request: Request,
  scope?: string,
): Promise<VerifiedToken | NextResponse> {
  const token = await verifyApiToken(request.headers.get("authorization"));
  if (!token) {
    return NextResponse.json(
      { error: "Требуется действительный Bearer-токен" },
      { status: 401 },
    );
  }
  if (scope && !hasScope(token, scope)) {
    return NextResponse.json(
      { error: `Недостаточно прав: нужен scope "${scope}"` },
      { status: 403 },
    );
  }
  return token;
}

export function isErrorResponse(
  result: VerifiedToken | NextResponse,
): result is NextResponse {
  return result instanceof NextResponse;
}
