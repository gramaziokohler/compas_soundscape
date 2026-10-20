"use client";

import { useEffect, useState } from "react";
import { apiService, type CurrentUser } from "@/services/api";
import { STUDY_LOG, UI_BORDER_RADIUS } from "@/utils/constants";
import { useStudyStore } from "@/store";
import { logStudyEvent } from "@/lib/study/studyLogger";

const ACK_KEY = "compas-privacy-ack";

function readAck(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

/**
 * First-run informational notice.
 *
 * Discloses the essential session cookie + server-side storage. This is NOT a
 * cookie-consent gate: only strictly-necessary cookies/localStorage are used
 * (no analytics/tracking), so no consent is legally required. If analytics or
 * third-party embeds are ever added, replace this with a real consent flow.
 *
 * While the research study is on (STUDY_LOGGING_ENABLED), the notice instead
 * discloses the interaction logging, has its own acknowledgement key (so it is
 * shown even to people who dismissed the normal notice) and logs `consent.ack`.
 * Participants' informed consent is collected outside the app.
 *
 * Usage:
 *   <PrivacyNotice />
 */
export function PrivacyNotice() {
  const [visible, setVisible] = useState(false);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const studyEnabled = useStudyStore((s) => s.enabled);
  const pseudonym = useStudyStore((s) => s.pseudonym);
  const ackKey = studyEnabled ? STUDY_LOG.CONSENT_STORAGE_KEY : ACK_KEY;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (readAck(ackKey)) return;
    setVisible(true);
    apiService
      .getCurrentUser()
      .then(setUser)
      .catch(() => {});
  }, [ackKey]);

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
        {studyEnabled ? (
          <span className="text-secondary-hover">
            Research study in progress: this app records how you use it (what you play and
            from where, edits, AI requests and results, simulations, the notes and moments
            you add, and screenshots when you capture a moment), together with your design
            states and generated audio. Data is pseudonymised when exported for analysis
            {pseudonym ? <> — your study ID is <span className="study-id">{pseudonym}</span></> : null}.
          </span>
        ) : (
        <span className="text-secondary-hover">
          This app stores an essential session cookie and keeps your saved soundscape
          data, audio and settings on the server. Generated audio is processed on the
          server; some prompts/audio are sent to third-party AI services. Temporary
          files are cleaned after ~24h; saved projects persist until you delete them.
        </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          try {
            window.localStorage.setItem(ackKey, "1");
          } catch {
            /* ignore */
          }
          if (studyEnabled) logStudyEvent("consent.ack", { notice: "study" });
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
