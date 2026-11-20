"use client";

import { AppErrorPanel } from "@/components/ui/AppErrorPanel";

/** Route-level error boundary (Next.js): a render error shows a recovery panel, never a blank page. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <AppErrorPanel error={error} reset={reset} />;
}
