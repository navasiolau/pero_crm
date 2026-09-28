// Public health response intentionally contains no versions, DSN or exception.
// The injected operation is a SELECT 1, not a business query or a write.
export async function databaseHealth(check: () => Promise<unknown>) {
  try {
    await check();
    return Response.json(
      { status: "ok", service: "pero-crm", database: "ok", checkedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "degraded", service: "pero-crm", database: "unavailable", checkedAt: new Date().toISOString() },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
