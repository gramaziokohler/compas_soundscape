import { useState, useEffect } from 'react';
import { apiService, type ServiceVersions } from '@/services/api';
import { useSoundscapeStore } from '@/store/soundscapeStore';

export function useServiceVersions(): ServiceVersions | null {
  const [versions, setVersions] = useState<ServiceVersions | null>(null);
  const llmModel = useSoundscapeStore((state) => state.llmModel);

  useEffect(() => {
    apiService.getServiceVersions(llmModel).then(setVersions).catch(() => {});
  }, [llmModel]);

  return versions;
}
