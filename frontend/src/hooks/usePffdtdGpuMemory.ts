'use client';

import { useEffect, useState } from 'react';
import { apiService } from '@/services/api';
import { PFFDTD } from '@/utils/constants';
import type { PffdtdGpuMemory } from '@/types/pffdtd';

/**
 * GPU memory a wave solve can use now (GET /api/pffdtd/gpu-memory), refreshed every
 * PFFDTD.GPU_MEMORY_POLL_MS while a caller is mounted (the wave-based / hybrid card settings).
 * null until the first answer, or when the request fails.
 */
export function usePffdtdGpuMemory(): PffdtdGpuMemory | null {
  const [memory, setMemory] = useState<PffdtdGpuMemory | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      apiService.getPffdtdGpuMemory()
        .then((m) => { if (!cancelled) setMemory(m); })
        .catch(() => { if (!cancelled) setMemory(null); });
    };
    load();
    const id = setInterval(load, PFFDTD.GPU_MEMORY_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return memory;
}
