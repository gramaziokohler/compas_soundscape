'use client';

import { use } from 'react';
import Home from '@/app/page';
import { useShareViewStore } from '@/store';

/**
 * Public read-only share page (`/share/<share_id>`), embeddable in an iframe.
 *
 * Reuses the main orchestration page. The share view store is entered during
 * this first render — before any child mount effect runs — so the bootstrap
 * loads the public share instead of a workspace model and every editing
 * control is hidden (`hooks/useCanEdit.ts`).
 */
export default function SharePage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = use(params);
  const shareView = useShareViewStore.getState();
  if (shareView.shareId !== shareId) shareView.enterShareView(shareId);
  return <Home />;
}
