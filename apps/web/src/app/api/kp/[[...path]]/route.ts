import { handleKpApi } from "@/server/kp/api-runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path?: string[] }> };
async function handle(request: Request, context: Context) {
  const response = await handleKpApi(request, (await context.params).path ?? [], "session");
  response.headers.set("X-KP-Server-Time", String(Date.now()));
  return response;
}
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const PATCH = handle;
export const HEAD = handle;
export const OPTIONS = handle;
