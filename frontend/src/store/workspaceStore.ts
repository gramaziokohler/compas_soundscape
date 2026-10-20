"use client";

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { apiService, type WorkspaceDetail, type WorkspaceInvite, type WorkspaceSummary } from "@/services/api";
import { useUIStore } from "./uiStore";

/**
 * Active workspace + collaboration state (shared sessions).
 *
 * The backend keeps a durable session→workspace binding; this store mirrors it
 * in the browser and polls presence. Only the workspace owner's changes are
 * saved — every other member is a view-only viewer (see
 * `selectIsReadOnlyWorkspace`). Membership actions (invite, remove, leave,
 * transfer) are all server-authoritative — the returned workspace view replaces
 * local state. The heartbeat also reports the caller's role, so an ownership
 * transfer made elsewhere is picked up without a reload.
 */

const HEARTBEAT_MS = 25000;

interface WorkspaceState {
  workspace: WorkspaceDetail | null;
  presence: number;
  /** Latest workspace content revision (refreshed by the presence heartbeat). */
  revision: number;
  /**
   * Revision of the soundscape currently shown (set on load / "Load latest").
   * A viewer whose `revision` moves past it can pull the owner's newer save.
   */
  loadedRevision: number;
  loading: boolean;
  error: string | null;
  /** Set when a save was rejected because the workspace moved on (409). */
  conflictRevision: number | null;
  inviteUrl: string | null;
  invites: WorkspaceInvite[];
  /** All workspaces this user can switch to (personal + joined). */
  workspaces: WorkspaceSummary[];

  /**
   * Load the active workspace and start the heartbeat. With `preferOwn` (the
   * Home page — no model open) the session is moved back to the workspace the
   * user owns, so Home never shows someone else's workspace / a viewer role.
   */
  init: (options?: { preferOwn?: boolean }) => Promise<void>;
  refresh: () => Promise<void>;
  switchTo: (workspaceId: string) => Promise<void>;
  create: (name?: string) => Promise<void>;
  join: (token: string) => Promise<void>;
  /** Create a view-only invite link (any member may share). */
  createInvite: (
    options?: { expiresInS?: number; maxUses?: number; modelId?: string | null },
  ) => Promise<string | null>;
  loadWorkspaces: () => Promise<void>;
  loadInvites: () => Promise<void>;
  revokeInvite: (inviteId: string) => Promise<void>;
  setSharingMode: (mode: "private" | "link") => Promise<void>;
  leave: () => Promise<void>;
  removeMember: (userHash: string) => Promise<void>;
  transferOwnership: (userHash: string) => Promise<void>;
  heartbeat: () => Promise<void>;
  clearConflict: () => void;
  setLoadedRevision: (revision: number) => void;
}

let _heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/**
 * True when the active workspace belongs to someone else: the user can still
 * edit locally, but nothing is saved (autosave off, Save button disabled).
 * No workspace (anonymous dev session) is never read-only.
 */
export const selectIsReadOnlyWorkspace = (s: Pick<WorkspaceState, "workspace">): boolean =>
  !!s.workspace && s.workspace.role !== "owner";

/** True when the workspace was saved (by the owner) after the shown soundscape was loaded. */
export const selectHasNewerSave = (s: Pick<WorkspaceState, "revision" | "loadedRevision">): boolean =>
  s.revision > s.loadedRevision;

export const useWorkspaceStore = create<WorkspaceState>()(
  devtools(
    (set, get) => ({
  workspace: null,
  presence: 1,
  revision: 0,
  loadedRevision: 0,
  loading: false,
  error: null,
  conflictRevision: null,
  inviteUrl: null,
  invites: [],
  workspaces: [],

  init: async (options) => {
    set({ loading: true, error: null }, false, "workspace/init");
    try {
      const me = await apiService.getCurrentUser();
      if (me.workspace_id) {
        let ws = await apiService.getWorkspace(me.workspace_id);
        if (options?.preferOwn && ws.role !== "owner") {
          const workspaces = await apiService.listWorkspaces();
          const own = workspaces.find((w) => w.role === "owner");
          if (own) {
            // Nothing is loaded on Home yet, so a plain rebind is enough (no reload).
            ws = await apiService.switchWorkspace(own.id);
            set({ workspaces }, false, "workspace/initPreferOwn");
          }
        }
        set(
          { workspace: ws, presence: ws.presence ?? 1, revision: ws.revision, loading: false },
          false,
          "workspace/initDone",
        );
      } else {
        set({ loading: false }, false, "workspace/initNoWs");
      }
    } catch (err) {
      set(
        { loading: false, error: err instanceof Error ? err.message : "Failed to load workspace" },
        false,
        "workspace/initError",
      );
    }
    if (_heartbeatTimer) clearInterval(_heartbeatTimer);
    _heartbeatTimer = setInterval(() => void get().heartbeat(), HEARTBEAT_MS);
    void get().loadWorkspaces();
  },

  refresh: async () => {
    const ws = get().workspace;
    if (!ws) return;
    try {
      const fresh = await apiService.getWorkspace(ws.id);
      set(
        { workspace: fresh, presence: fresh.presence ?? 1, revision: fresh.revision },
        false,
        "workspace/refresh",
      );
    } catch {
      /* keep the last known state */
    }
  },

  switchTo: async (workspaceId) => {
    const ws = await apiService.switchWorkspace(workspaceId);
    set({ workspace: ws, presence: ws.presence ?? 1, revision: ws.revision }, false, "workspace/switch");
    // Domain data (soundscape, jobs, IRs) is scoped to the workspace, so a
    // switch must rebootstrap. A reload is the safe, simple way to guarantee
    // no stale state from the previous workspace is autosaved into the new one.
    if (typeof window !== "undefined") window.location.reload();
  },

  create: async (name) => {
    const ws = await apiService.createWorkspace(name);
    set({ workspace: ws, presence: 1, revision: ws.revision }, false, "workspace/create");
  },

  join: async (token) => {
    const ws = await apiService.joinWorkspace(token);
    set({ workspace: ws, presence: ws.presence ?? 1, revision: ws.revision }, false, "workspace/join");
    void get().loadWorkspaces();
  },

  createInvite: async (options) => {
    const ws = get().workspace;
    if (!ws) return null;
    const modelId =
      options?.modelId ?? useUIStore.getState().globalSpeckleData?.model_id ?? null;
    const invite = await apiService.createWorkspaceInvite(ws.id, { ...options, modelId });
    const url = `${window.location.origin}${invite.url}`;
    set({ inviteUrl: url }, false, "workspace/invite");
    // Only the owner can list/revoke invites.
    if (ws.role === "owner") void get().loadInvites();
    return url;
  },

  loadWorkspaces: async () => {
    try {
      const workspaces = await apiService.listWorkspaces();
      set({ workspaces }, false, "workspace/loadWorkspaces");
    } catch {
      /* non-critical */
    }
  },

  loadInvites: async () => {
    const ws = get().workspace;
    if (!ws) return;
    try {
      const invites = await apiService.listWorkspaceInvites(ws.id);
      set({ invites }, false, "workspace/loadInvites");
    } catch {
      /* non-critical */
    }
  },

  revokeInvite: async (inviteId) => {
    const ws = get().workspace;
    if (!ws) return;
    await apiService.revokeWorkspaceInvite(ws.id, inviteId);
    set(
      { invites: get().invites.map((i) => (i.id === inviteId ? { ...i, revoked: true } : i)) },
      false,
      "workspace/revokeInvite",
    );
  },

  setSharingMode: async (mode) => {
    const ws = get().workspace;
    if (!ws) return;
    const updated = await apiService.updateWorkspace(ws.id, { sharing_mode: mode });
    set({ workspace: { ...ws, ...updated } }, false, "workspace/sharingMode");
  },

  leave: async () => {
    const ws = get().workspace;
    if (!ws) return;
    await apiService.leaveWorkspace(ws.id);
    set({ workspace: null, presence: 1, invites: [] }, false, "workspace/leave");
    if (typeof window !== "undefined") window.location.reload();
  },

  removeMember: async (userHash) => {
    const ws = get().workspace;
    if (!ws) return;
    const updated = await apiService.removeWorkspaceMember(ws.id, userHash);
    set({ workspace: { ...ws, ...updated } }, false, "workspace/removeMember");
  },

  transferOwnership: async (userHash) => {
    const ws = get().workspace;
    if (!ws) return;
    const updated = await apiService.transferWorkspaceOwnership(ws.id, userHash);
    set({ workspace: { ...ws, ...updated } }, false, "workspace/transferOwnership");
  },

  heartbeat: async () => {
    const ws = get().workspace;
    if (!ws) return;
    const { presence, revision, role } = await apiService.workspaceHeartbeat(ws.id);
    set({ presence, revision }, false, "workspace/heartbeat");
    // Ownership moved (to or away from this user) — reload the full view so
    // the role, members list and save gating update.
    if (role && role !== ws.role) void get().refresh();
  },

  clearConflict: () => set({ conflictRevision: null }, false, "workspace/clearConflict"),

  setLoadedRevision: (revision) =>
    set(
      // The load also reports the newest revision — never let the heartbeat value lag behind it.
      (s) => ({ loadedRevision: revision, revision: Math.max(s.revision, revision) }),
      false,
      "workspace/setLoadedRevision",
    ),
    }),
    { name: "workspace" },
  ),
);
