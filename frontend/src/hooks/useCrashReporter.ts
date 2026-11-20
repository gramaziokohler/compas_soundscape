/**
 * useCrashReporter — always-on, silent crash detection for every view (share view
 * included): heartbeat per tab, dead sessions reported on the next load to the
 * backend client-diagnostics log. See lib/diagnostics/crash-reporter.ts.
 */
import { useEffect } from 'react';
import { startCrashReporter } from '@/lib/diagnostics/crash-reporter';

export function useCrashReporter(): void {
  useEffect(() => startCrashReporter(), []);
}
