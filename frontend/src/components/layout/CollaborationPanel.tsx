"use client";

import { useState } from "react";
import { Users, Link2, Check } from "lucide-react";
import { useWorkspaceStore } from "@/store";
import { UI_BORDER_RADIUS } from "@/utils/constants";

/**
 * Workspace collaboration panel (shared sessions).
 *
 * Shows who else is active on the workspace, lets owners copy an invite link,
 * and warns when autosave is paused because multiple members are editing.
 *
 * Usage:
 *   <CollaborationPanel />
 */
export function CollaborationPanel() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const presence = useWorkspaceStore((s) => s.presence);
  const createInvite = useWorkspaceStore((s) => s.createInvite);
  const setSharingMode = useWorkspaceStore((s) => s.setSharingMode);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!workspace) return null;

  const isOwner = workspace.role === "owner";
  const multi = presence > 1;

  const handleInvite = async () => {
    setBusy(true);
    try {
      const url = await createInvite("editor");
      setInviteUrl(url);
      if (url) {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* clipboard unavailable ÔÇö the URL is shown below */
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-[10px] text-secondary-hover">
        <Users size={12} />
        <span className="font-medium text-foreground truncate">{workspace.name}</span>
        <span>┬À {workspace.role}</span>
      </div>
      <div className="text-[10px] text-secondary-hover">
        {multi
          ? `${presence} people are on this workspace`
          : "You are the only person here"}
        {" ┬À "}
        rev {workspace.revision}
      </div>
      {multi && (
        <div
          className="text-[10px] leading-tight px-1.5 py-1"
          style={{
            background: "color-mix(in srgb, var(--color-warning, #d97706) 15%, transparent)",
            color: "var(--color-warning, #d97706)",
            borderRadius: `${UI_BORDER_RADIUS.SM}px`,
          }}
        >
          Autosave is paused while others are editing. Save manually.
        </div>
      )}

      {isOwner && (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={handleInvite}
            disabled={busy}
            className="flex items-center justify-center gap-1 py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-50"
            style={{ background: "var(--color-primary)", color: "var(--color-on-blue)", borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
          >
            {copied ? <Check size={12} /> : <Link2 size={12} />}
            {copied ? "Link copied" : busy ? "CreatingÔÇª" : "Copy invite link"}
          </button>
          {inviteUrl && (
            <input
              readOnly
              value={inviteUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full px-2 py-1 text-[10px] rounded bg-secondary-lighter text-foreground border border-secondary-light focus:outline-none"
              style={{ borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
            />
          )}
          <label className="flex items-center justify-between gap-2 text-[10px] text-secondary-hover">
            <span>Anyone with the link can join as editor</span>
            <input
              type="checkbox"
              checked={workspace.sharing_mode === "link"}
              onChange={(e) => void setSharingMode(e.target.checked ? "link" : "private")}
            />
          </label>
        </div>
      )}
    </div>
  );
}
