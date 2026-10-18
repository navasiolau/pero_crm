import { notFound } from 'next/navigation';
import { kpEditorSession } from '@/server/kp/editor-session';
import { ProposalsWorkspace } from './workspace';

export const dynamic = 'force-dynamic';
export default async function ProposalsPage() {
  const actor = await kpEditorSession(); if (!actor) notFound();
  return <ProposalsWorkspace actorId={actor.id} />;
}
