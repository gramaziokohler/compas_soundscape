import { useState, useEffect } from 'react';
import { apiService, type ServiceVersions } from '@/services/api';

export function useServiceVersions(): ServiceVersions | null {
  const [versions, setVersions] = useState<ServiceVersions | null>(null);

  useEffect(() => {
    apiService.getServiceVersions().then(setVersions).catch(() => {});
  }, []);

  return versions;
}
