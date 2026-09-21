'use client';

import { useEffect, useState } from 'react';
import { detectMac } from '@/utils/platform';

/**
 * Returns true when the app is running on a macOS device.
 *
 * Starts `false` and resolves after mount so server-rendered markup and the
 * first client render always agree (avoids hydration mismatches).
 */
export function useIsMac(): boolean {
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    setIsMac(detectMac());
  }, []);
  return isMac;
}
