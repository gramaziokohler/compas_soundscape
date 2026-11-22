'use client';

import { useEffect, useState } from 'react';
import { apiService } from '@/services/api';
import { PFFDTD } from '@/utils/constants';
import type { PffdtdGpuMemory } from '@/types/pffdtd';

// One poll shared by every mounted caller (a card's grid estimate and its slider limits).
const subscribers = new Set<(memory: PffdtdGpuMemory | null) => void>();
let latest: PffdtdGpuMemory | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function load(): void {
  apiService.getPffdtdGpuMemory()
    .then((m) => { latest = m; })
    .catch(() => { latest = null; })
    .finally(() => subscribers.forEach((notify) => notify(latest)));
}

/**
 * GPU memory a wave solve can use now (GET /api/pffdtd/gpu-memory), refreshed every
 * PFFDTD.GPU_MEMORY_POLL_MS while a caller is mounted (the wave-based / hybrid card settings).
 * null until the first answer, or when the request fails.
 */
export function usePffdtdGpuMemory(): PffdtdGpuMemory | null {
  const [memory, setMemory] = useState<PffdtdGpuMemory | null>(latest);

  useEffect(() => {
    subscribers.add(setMemory);
    if (timer === null) {
      load();
      timer = setInterval(load, PFFDTD.GPU_MEMORY_POLL_MS);
    }
    return () => {
      subscribers.delete(setMemory);
      if (subscribers.size === 0 && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, []);

  return memory;
}
