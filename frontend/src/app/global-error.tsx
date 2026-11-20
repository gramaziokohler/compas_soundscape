"use client";

import "./globals.css";
import { AppErrorPanel } from "@/components/ui/AppErrorPanel";

/** Root error boundary (Next.js): replaces the root layout, so it renders its own html/body. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground">
        <AppErrorPanel error={error} reset={reset} />
      </body>
    </html>
  );
}
