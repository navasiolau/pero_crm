import { browserAsset } from '@pero/kp-template';
import { kpEditorSession } from '@/server/kp/editor-session';
import { kpPrivateHeaders } from '@/server/kp/editor-frame';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  if (!await kpEditorSession()) return new Response(null, { status: 404, headers: kpPrivateHeaders });
  const { path } = await context.params;
  const name = path.join('/'), extension = name.split('.').pop();
  const mime = { js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', woff2: 'font/woff2', png: 'image/png' }[extension ?? ''];
  if (!mime) return new Response(null, { status: 404, headers: kpPrivateHeaders });
  try { return new Response(new Uint8Array(browserAsset('public/' + name)), { headers: { ...kpPrivateHeaders, 'Content-Type': mime } }); }
  catch { return new Response(null, { status: 404, headers: kpPrivateHeaders }); }
}
