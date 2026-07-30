import { useState, useEffect, useRef } from 'react';
import { apiService, type ServiceVersions } from '@/services/api';
import { useSoundscapeStore } from '@/store/soundscapeStore';
import { notifyError } from '@/store';
import { LLM_MODEL_TO_PROVIDER } from '@/utils/constants';

let _cpuWarningShown = false;

function enrichLlmProviders(v: ServiceVersions, llmModel: string): ServiceVersions {
  const providerKey = LLM_MODEL_TO_PROVIDER[llmModel];
  if (!providerKey) return v;

  const providers = v.llm_providers;
  const providerKeyTyped = providerKey as keyof typeof providers;
  const provider = providers[providerKeyTyped];
  if (!provider) return v;

  return {
    ...v,
    llm_providers: {
      ...providers,
      [providerKey]: {
        ...provider,
        name: llmModel,
        version: '',
      },
    },
  };
}

export function useServiceVersions(): ServiceVersions | null {
  const [versions, setVersions] = useState<ServiceVersions | null>(null);
  const llmModel = useSoundscapeStore((state) => state.llmModel);
  const llmModelRef = useRef(llmModel);

  useEffect(() => {
    llmModelRef.current = llmModel;
    apiService.getServiceVersions(llmModel).then((v) => {
      const enriched = enrichLlmProviders(v, llmModelRef.current);
      setVersions(enriched);
      if (!_cpuWarningShown && v.tangoflux?.device === 'cpu') {
        _cpuWarningShown = true;
        notifyError(
          'Audio generation is running on CPU — generation will be slow. A CUDA or MPS GPU is recommended.',
          'warning'
        );
      }
    }).catch(() => {});
  }, [llmModel]);

  return versions;
}
