"use client";

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { apiService, type WorkspaceDetail } from "@/services/api";

/**
 * Active workspace + collaboration state (shared sessions).
 *
 * The backend keeps a durable sessionÔåÆworkspace binding; this store mirrors it
 * in the browser and polls presence so the UI can warn when several people are
 * on the same model (and pause autosave).
 */

const HEARTBEAT_MS = 25000;

interface WorkspaceState {
  workspace: WorkspaceDetail | null;
  presence: number;
  revision: number;
  loading: boolean;
  error: string | null;
  /** Set when a save was rejected because the workspace moved on (409). */
  conflictRevision: number | null;
  inviteUrl: string | null;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  switchTo: (workspaceId: string) => Promise<void>;
  create: (name?: string) => Promise<void>;
  join: (token: string) => Promise<void>;
  createInvite: (role?: "editor" | "viewer") => Promise<string | null>;
  setSharingMode: (mode: "private" | "link") => Promise<void>;
  heartbeat: () => Promise<void>;
  clearConflict: () => void;
}

let _heartbeatTimer: ReturnType<typeof setInterval> | null = null;

export const useWorkspaceStore = create<WorkspaceState>()(
  devtools(
    (set, get) => ({
  workspace: null,
  presence: 1,
  revision: 0,
  loading: false,
  error: null,
  conflictRevision: null,
  inviteUrl: null,

  init: async () => {
    set({ loading: true, error: null }, false, "workspace/init");
    try {
      const me = await apiService.getCurrentUser();
      if (me.workspace_id) {
        const ws = await apiService.getWorkspace(me.workspace_id);
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
  },

  create: async (name) => {
    const ws = await apiService.createWorkspace(name);
    set({ workspace: ws, presence: 1, revision: ws.revision }, false, "workspace/create");
  },

  join: async (token) => {
    const ws = await apiService.joinWorkspace(token);
    set({ workspace: ws, presence: ws.presence ?? 1, revision: ws.revision }, false, "workspace/join");
  },

  createInvite: async (role = "editor") => {
    const ws = get().workspace;
    if (!ws) return null;
    const invite = await apiService.createWorkspaceInvite(ws.id, role);
    const url = `${window.location.origin}${invite.url}`;
    set({ inviteUrl: url }, false, "workspace/invite");
    return url;
  },

  setSharingMode: async (mode) => {
    const ws = get().workspace;
    if (!ws) return;
    const updated = await apiService.updateWorkspace(ws.id, { sharing_mode: mode });
    set({ workspace: { ...ws, ...updated } }, false, "workspace/sharingMode");
  },

  heartbeat: async () => {
    const ws = get().workspace;
    if (!ws) return;
    const { presence, revision } = await apiService.workspaceHeartbeat(ws.id);
    set({ presence, revision }, false, "workspace/heartbeat");
  },

  clearConflict: () => set({ conflictRevision: null }, false, "workspace/clearConflict"),
    }),
    { name: "workspace" },
  ),
);
