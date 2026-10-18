import { kpEditorSession } from '@/server/kp/editor-session';
import { buildKpEditorFrame, kpPrivateHeaders } from '@/server/kp/editor-frame';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  const actor = await kpEditorSession(); if (!actor) return new Response(null, { status: 404, headers: kpPrivateHeaders });
  const documentId = new URL(request.url).searchParams.get('documentId');
  if (!documentId || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(documentId)) return new Response(null, { status: 404, headers: kpPrivateHeaders });
  return new Response(await buildKpEditorFrame({ documentId, actorId: actor.id, apiBase: '/api/kp' }), { headers: {
    ...kpPrivateHeaders, 'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
  } });
}
