import { useEffect, useRef } from 'react';
import { useUIStore } from '@/store';

/**
 * Run `onCollapse` whenever a global "reduce every floating pop-up" request is
 * made (`useUIStore.requestFloatingPanelsCollapse`, fired on every model open
 * and page load). For panels whose open state lives in local component state —
 * the Simple-mode bubble panels and the DAW auto-open latch — which the store
 * flags alone cannot reach. Never fires on mount.
 *
 * Usage:
 * ```tsx
 * useOnFloatingPanelsCollapse(() => setPanel(null));
 * ```
 */
export function useOnFloatingPanelsCollapse(onCollapse: () => void): void {
  const nonce = useUIStore((s) => s.floatingPanelsCollapseNonce);
  const onCollapseRef = useRef(onCollapse);
  onCollapseRef.current = onCollapse;
  const lastNonceRef = useRef(nonce);

  useEffect(() => {
    if (nonce === lastNonceRef.current) return;
    lastNonceRef.current = nonce;
    onCollapseRef.current();
  }, [nonce]);
}
