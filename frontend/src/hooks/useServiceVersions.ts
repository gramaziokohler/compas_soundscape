import { useState, useEffect } from 'react';
import { apiService, type ServiceVersions } from '@/services/api';
import { useSoundscapeStore } from '@/store/soundscapeStore';
import { useErrorsStore } from '@/store/errorsStore';

let _cpuWarningShown = false;

export function useServiceVersions(): ServiceVersions | null {
  const [versions, setVersions] = useState<ServiceVersions | null>(null);
  const llmModel = useSoundscapeStore((state) => state.llmModel);

  useEffect(() => {
    apiService.getServiceVersions(llmModel).then((v) => {
      setVersions(v);
      if (!_cpuWarningShown && v.tangoflux?.device === 'cpu') {
        _cpuWarningShown = true;
        useErrorsStore.getState().addError(
          'Audio generation is running on CPU — generation will be slow. A CUDA or MPS GPU is recommended.',
          'warning'
        );
      }
    }).catch(() => {});
  }, [llmModel]);

  return versions;
}
