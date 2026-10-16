import { useAnalysisStore } from '@/store';
import type { CardAnalysisStatus } from '@/types/analysis';

export interface CardAnalysisState extends CardAnalysisStatus {
  isAnalyzing: boolean;
}

const IDLE: CardAnalysisState = { isAnalyzing: false, status: '', thinking: '', progress: 0 };

/**
 * Live analysis state of one card. Cards analyze concurrently, so a card's
 * spinner / disabled inputs must follow only its own run.
 *
 * Usage:
 * ```tsx
 * const { isAnalyzing, status, progress } = useCardAnalysisStatus(originalIndex);
 * ```
 */
export function useCardAnalysisStatus(index: number | null): CardAnalysisState {
  const isAnalyzing = useAnalysisStore((s) => index !== null && s.analyzingConfigIndices.has(index));
  const entry = useAnalysisStore((s) => (index !== null ? s.analysisStatusByIndex[index] : undefined));
  if (!isAnalyzing) return IDLE;
  return { isAnalyzing, ...(entry ?? IDLE) };
}
