"use client";

import { useEffect, useState } from "react";
import { apiService, type CurrentUser } from "@/services/api";
import { UI_BORDER_RADIUS } from "@/utils/constants";

const ACK_KEY = "compas-privacy-ack";

/**
 * First-run informational notice.
 *
 * Discloses the essential session cookie + server-side storage. This is NOT a
 * cookie-consent gate: only strictly-necessary cookies/localStorage are used
 * (no analytics/tracking), so no consent is legally required. If analytics or
 * third-party embeds are ever added, replace this with a real consent flow.
 *
 * Usage:
 *   <PrivacyNotice />
 */
export function PrivacyNotice() {
  const [visible, setVisible] = useState(false);
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(ACK_KEY) === "1") return;
    setVisible(true);
    apiService
      .getCurrentUser()
      .then(setUser)
      .catch(() => {});
  }, []);

  if (!visible) return null;

  const identity =
    user?.email && !user.email.startsWith("anon+")
      ? `Signed in as ${user.email}.`
      : "You are signed in anonymously on this browser.";

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex items-start gap-3 px-3 py-2 shadow-lg"
      style={{
        background: "var(--color-overlay-bg)",
        border: "1px solid var(--color-overlay-border)",
        borderRadius: `${UI_BORDER_RADIUS.SM}px`,
        maxWidth: "min(560px, 92vw)",
        backdropFilter: "blur(8px)",
      }}
      role="status"
    >
      <div className="flex flex-col gap-0.5 text-[11px] leading-snug text-foreground">
        <span className="font-medium">{identity}</span>
        <span className="text-secondary-hover">
          This app stores an essential session cookie and keeps your saved soundscape
          data, audio and settings on the server. Generated audio is processed on the
          server; some prompts/audio are sent to third-party AI services. Temporary
          files are cleaned after ~24h; saved projects persist until you delete them.
        </span>
      </div>
      <button
        type="button"
        onClick={() => {
          try {
            window.localStorage.setItem(ACK_KEY, "1");
          } catch {
            /* ignore */
          }
          setVisible(false);
        }}
        className="shrink-0 px-2 py-1 text-[11px] font-medium transition-opacity hover:opacity-80"
        style={{
          background: "var(--color-primary)",
          color: "var(--color-on-blue)",
          borderRadius: `${UI_BORDER_RADIUS.SM}px`,
        }}
      >
        Got it
      </button>
    </div>
  );
}
