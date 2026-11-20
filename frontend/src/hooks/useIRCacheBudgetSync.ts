/**
 * useIRCacheBudgetSync — pushes the Advanced-settings "IR memory" choice
 * (uiStore.irCacheBudgetMB; null = Auto) to the AudioOrchestrator's IR cache.
 */
import { useEffect } from 'react';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';
import { useUIStore } from '@/store';
import { MEMORY_UNITS } from '@/utils/constants';

export function useIRCacheBudgetSync(orchestrator: AudioOrchestrator | null): void {
  const budgetMB = useUIStore((s) => s.irCacheBudgetMB);
  useEffect(() => {
    orchestrator?.setIRCacheBudget(budgetMB === null ? null : budgetMB * MEMORY_UNITS.BYTES_PER_MB);
  }, [orchestrator, budgetMB]);
}
