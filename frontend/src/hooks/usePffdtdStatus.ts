'use client';

import { useEffect, useState } from 'react';
import { apiService } from '@/services/api';
import type { PffdtdStatus } from '@/types/pffdtd';

export interface UsePffdtdStatusReturn extends PffdtdStatus {
  /** True until the first status response arrives. */
  loading: boolean;
}

const LOADING: UsePffdtdStatusReturn = {
  available: false,
  reason: 'Checking whether the wave solver is available...',
  loading: true,
};

/** One request per page load, shared by every caller. A failed request is retried on the next mount. */
let cached: Promise<PffdtdStatus> | null = null;

function fetchStatus(): Promise<PffdtdStatus> {
  if (!cached) {
    cached = apiService.getPffdtdStatus().catch((err: unknown) => {
      cached = null;
      return {
        available: false,
        reason: err instanceof Error ? `Wave solver status unavailable: ${err.message}` : 'Wave solver status unavailable',
      };
    });
  }
  return cached;
}

/**
 * Whether this deployment can run PFFDTD (GET /api/pffdtd/status). Gates the
 * "Wave-based simulation" add-menu entry and the card's run button; `reason`
 * is the tooltip when unavailable.
 */
export function usePffdtdStatus(): UsePffdtdStatusReturn {
  const [status, setStatus] = useState<UsePffdtdStatusReturn>(LOADING);

  useEffect(() => {
    let cancelled = false;
    void fetchStatus().then((s) => {
      if (!cancelled) setStatus({ available: s.available, reason: s.available ? null : s.reason, loading: false });
    });
    return () => { cancelled = true; };
  }, []);

  return status;
}
