"use client";

import { useEffect, useState } from "react";
import { Users, Link2, Check, Trash2, Crown, LogOut, X } from "lucide-react";
import { useWorkspaceStore, notifyError } from "@/store";
import { apiService, type CurrentUser, type WorkspaceMember } from "@/services/api";
import { UI_BORDER_RADIUS } from "@/utils/constants";
import { CardSelect } from "@/components/ui/CardSelect";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Badge } from "@/components/ui/Badge";

/**
 * Workspace collaboration panel (shared sessions).
 *
 * Shows who else is active on the workspace, lets owners invite people, manage
 * member roles, revoke invites, transfer ownership, and lets non-owners leave.
 * Warns when autosave is paused because multiple people are editing.
 *
 * Usage:
 *   <CollaborationPanel />
 */
export function CollaborationPanel() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const presence = useWorkspaceStore((s) => s.presence);
  const invites = useWorkspaceStore((s) => s.invites);
  const createInvite = useWorkspaceStore((s) => s.createInvite);
  const loadInvites = useWorkspaceStore((s) => s.loadInvites);
  const revokeInvite = useWorkspaceStore((s) => s.revokeInvite);
  const setSharingMode = useWorkspaceStore((s) => s.setSharingMode);
  const leave = useWorkspaceStore((s) => s.leave);
  const setMemberRole = useWorkspaceStore((s) => s.setMemberRole);
  const removeMember = useWorkspaceStore((s) => s.removeMember);
  const transferOwnership = useWorkspaceStore((s) => s.transferOwnership);

  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("editor");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "remove" | "transfer" | "leave"; member?: WorkspaceMember } | null>(null);

  const workspaceId = workspace?.id ?? null;
  const isOwner = workspace?.role === "owner";
  const canManage = workspace?.role === "owner" || workspace?.role === "editor";
  const multi = presence > 1;

  useEffect(() => {
    void apiService.getCurrentUser().then(setMe).catch(() => {});
  }, []);

  useEffect(() => {
    if (workspaceId && canManage) void loadInvites();
  }, [workspaceId, canManage, loadInvites]);

  if (!workspace) return null;

  const members = workspace.members ?? [];

  const handleInvite = async () => {
    setBusy(true);
    try {
      const url = await createInvite(inviteRole);
      setInviteUrl(url);
      if (url) {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* clipboard unavailable — the URL is shown below */
        }
      }
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Failed to create invite", "warning");
    } finally {
      setBusy(false);
    }
  };

  const runConfirmed = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === "remove" && confirm.member) await removeMember(confirm.member.user_hash);
      else if (confirm.kind === "transfer" && confirm.member) await transferOwnership(confirm.member.user_hash);
      else if (confirm.kind === "leave") await leave();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Action failed", "warning");
      setBusy(false);
      return;
    }
    setBusy(false);
    setConfirm(null);
  };

  const memberLabel = (m: WorkspaceMember) => m.display_name || m.email || m.user_hash.slice(0, 8);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-[10px] text-secondary-hover">
        <Users size={12} />
        <span className="font-medium text-foreground truncate">{workspace.name}</span>
        <span>{"\u00b7"} {workspace.role}</span>
      </div>
      <div className="text-[10px] text-secondary-hover">
        {multi
          ? `${presence} people are on this workspace`
          : "You are the only person here"}
        {" \u00b7 "}
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

      {/* Members */}
      {members.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[9px] uppercase tracking-wider text-secondary-hover">Members</span>
          {members.map((m) => {
            const isMe = me?.user_id === m.user_hash;
            const isOwnerRow = m.role === "owner";
            return (
              <div key={m.user_hash} className="flex items-center gap-1.5 text-[10px]">
                <span className="truncate flex-1 min-w-0 text-foreground">
                  {memberLabel(m)}
                  {isMe ? " (you)" : ""}
                </span>
                {isOwnerRow ? (
                  <Badge variant="primary" size="sm">owner</Badge>
                ) : canManage && isOwner ? (
                  <CardSelect
                    compact
                    value={m.role}
                    onChange={(v) => void setMemberRole(m.user_hash, v as "editor" | "viewer")}
                    options={[
                      { value: "editor", label: "Editor" },
                      { value: "viewer", label: "Viewer" },
                    ]}
                  />
                ) : (
                  <Badge variant="neutral" size="sm">{m.role}</Badge>
                )}
                {isOwner && !isOwnerRow && (
                  <>
                    <button
                      type="button"
                      title="Make owner"
                      aria-label={`Transfer ownership to ${memberLabel(m)}`}
                      className="shrink-0 text-secondary-hover hover:text-foreground transition-colors"
                      onClick={() => setConfirm({ kind: "transfer", member: m })}
                    >
                      <Crown size={12} />
                    </button>
                    <button
                      type="button"
                      title="Remove from workspace"
                      aria-label={`Remove ${memberLabel(m)}`}
                      className="shrink-0 text-secondary-hover transition-colors"
                      style={{ color: "var(--color-error)" }}
                      onClick={() => setConfirm({ kind: "remove", member: m })}
                    >
                      <X size={12} />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          message={
            confirm.kind === "leave"
              ? "Leave this workspace? You will lose access to its shared data."
              : confirm.kind === "transfer"
                ? `Make ${confirm.member ? memberLabel(confirm.member) : "this member"} the owner? You will become an editor.`
                : `Remove ${confirm.member ? memberLabel(confirm.member) : "this member"} from the workspace?`
          }
          confirmLabel={confirm.kind === "leave" ? "Leave" : confirm.kind === "transfer" ? "Transfer" : "Remove"}
          variant={confirm.kind === "transfer" ? "default" : "danger"}
          disabled={busy}
          onConfirm={() => void runConfirmed()}
          onCancel={() => setConfirm(null)}
        />
      )}

      {isOwner && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <CardSelect
              compact
              value={inviteRole}
              onChange={(v) => setInviteRole(v as "editor" | "viewer")}
              options={[
                { value: "editor", label: "Editor" },
                { value: "viewer", label: "Viewer" },
              ]}
            />
            <button
              type="button"
              onClick={() => void handleInvite()}
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-1 py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-50"
              style={{ background: "var(--color-primary)", color: "var(--color-on-blue)", borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
            >
              {copied ? <Check size={12} /> : <Link2 size={12} />}
              {copied ? "Link copied" : busy ? "Creating\u2026" : "Copy invite link"}
            </button>
          </div>
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
            <span>Anyone with the link can join</span>
            <input
              type="checkbox"
              checked={workspace.sharing_mode === "link"}
              onChange={(e) => void setSharingMode(e.target.checked ? "link" : "private")}
            />
          </label>
        </div>
      )}

      {/* Active invites */}
      {canManage && invites.filter((i) => !i.revoked).length > 0 && (
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] uppercase tracking-wider text-secondary-hover">Invites</span>
          {invites
            .filter((i) => !i.revoked)
            .map((inv) => (
              <div key={inv.id} className="flex items-center gap-1.5 text-[10px] text-secondary-hover">
                <span className="flex-1 min-w-0 truncate">
                  {inv.role}
                  {inv.expires_at ? ` \u00b7 expires ${new Date(inv.expires_at).toLocaleDateString()}` : " \u00b7 never expires"}
                  {inv.max_uses > 0 ? ` \u00b7 ${inv.used_count}/${inv.max_uses} used` : ""}
                </span>
                <button
                  type="button"
                  title="Revoke invite"
                  aria-label="Revoke invite"
                  className="shrink-0 transition-colors"
                  style={{ color: "var(--color-error)" }}
                  onClick={() => void revokeInvite(inv.id)}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
        </div>
      )}

      {workspace.role !== "owner" && (
        <button
          type="button"
          onClick={() => setConfirm({ kind: "leave" })}
          className="flex items-center justify-center gap-1 py-1 text-[10px] transition-opacity hover:opacity-70 text-secondary-hover"
        >
          <LogOut size={12} /> Leave workspace
        </button>
      )}
    </div>
  );
}
