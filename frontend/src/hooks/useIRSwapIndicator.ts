/**
 * useIRSwapIndicator — mirrors the AudioOrchestrator's IR swap state into
 * useTransportTimeStore for the bottom-bar "applying acoustics" indicator.
 *
 * Every simulation and listener switch goes through the orchestrator's swap
 * pipeline, so this covers all of them. The indicator appears only when preparing
 * takes longer than IR_SWAP.SPINNER_DELAY_MS (cached IRs finish within a frame and
 * would only flicker); the previous IRs keep playing meanwhile.
 */
import { useEffect } from 'react';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';
import { useTransportTimeStore } from '@/store';
import { IR_SWAP } from '@/utils/constants';

export function useIRSwapIndicator(orchestrator: AudioOrchestrator | null): void {
  useEffect(() => {
    if (!orchestrator) return;
    const { setApplyingIRs } = useTransportTimeStore.getState();
    let showTimer: ReturnType<typeof setTimeout> | null = null;
    let shown = false;
    let latest = { loaded: 0, total: 0 };

    const unsubscribe = orchestrator.onIRSwapState((state) => {
      if (state.phase === 'idle') {
        if (showTimer !== null) clearTimeout(showTimer);
        showTimer = null;
        shown = false;
        setApplyingIRs(false);
        return;
      }
      latest = { loaded: state.loaded, total: state.total };
      if (shown) {
        setApplyingIRs(true, latest);
      } else if (showTimer === null) {
        showTimer = setTimeout(() => {
          showTimer = null;
          shown = true;
          setApplyingIRs(true, latest);
        }, IR_SWAP.SPINNER_DELAY_MS);
      }
    });

    return () => {
      if (showTimer !== null) clearTimeout(showTimer);
      unsubscribe();
      setApplyingIRs(false);
    };
  }, [orchestrator]);
}
