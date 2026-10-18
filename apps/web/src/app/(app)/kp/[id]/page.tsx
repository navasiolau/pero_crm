import { notFound } from 'next/navigation';
import { kpEditorSession } from '@/server/kp/editor-session';
import { KpEditor } from './editor';

export const dynamic = 'force-dynamic';
export default async function ProposalEditorPage({ params }: { params: Promise<{ id: string }> }) {
  if (!await kpEditorSession()) notFound();
  const { id } = await params;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(id)) notFound();
  return <KpEditor documentId={id} />;
}
