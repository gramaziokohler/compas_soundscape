"use client";

import { useMemo, useState } from "react";
import { Check, Code2, Link2, RefreshCw, Unlink } from "lucide-react";
import { Checkbox } from "@/components/ui/Checkbox";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ShareLinkBoard } from "./ShareLinkBoard";
import { useSoundScenes } from "@/hooks/useSoundScenes";
import { useShareLink, shareEmbedCode } from "@/hooks/useShareLink";
import {
  useAcousticsSimulationStore,
  useGridListenersStore,
  useReceiversStore,
  useShareConfigStore,
  useUIStore,
  useWorkspaceStore,
  selectIsReadOnlyWorkspace,
} from "@/store";
import type { ShareItemKind } from "@/types/share";
import { SHARE_SETTINGS, UI_BORDER_RADIUS } from "@/utils/constants";

interface ShareItem {
  id: string;
  label: string;
}

const HEADING_CLASS = "text-[9px] uppercase tracking-wider text-secondary-hover";
const ACTION_CLASS =
  "flex flex-1 items-center justify-center gap-1 py-1.5 text-[10px] font-medium rounded transition-colors disabled:opacity-50";

function ShareItemChecklist({
  title,
  items,
  selected,
  disabled,
  onToggle,
}: {
  title: string;
  items: ShareItem[];
  selected: string[];
  disabled: boolean;
  onToggle: (id: string, shared: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className={HEADING_CLASS}>{title}</span>
      {items.length === 0 ? (
        <span className="text-[10px] text-secondary-hover">{SHARE_SETTINGS.EMPTY_LIST}</span>
      ) : (
        items.map((item) => {
          const checked = selected.includes(item.id);
          return (
            <label key={item.id} className="flex items-center gap-1.5 text-[10px] text-foreground cursor-pointer">
              <Checkbox
                size={12}
                checked={checked}
                disabled={disabled}
                label={item.label}
                onChange={(next) => onToggle(item.id, next)}
              />
              <span className="truncate">{item.label}</span>
            </label>
          );
        })
      )}
    </div>
  );
}

/**
 * Settings → Share: choose the scenes / simulations / listeners a public
 * `/share/<id>` link exposes, group them into links, and manage the link.
 * The selection is saved with the soundscape (autosave), so the share is live.
 */
export function ShareSettingsSection() {
  const modelId = useUIStore((s) => s.globalSpeckleData?.model_id ?? null);
  const isReadOnly = useWorkspaceStore(selectIsReadOnlyWorkspace);
  const scenes = useSoundScenes();
  const simulationConfigs = useAcousticsSimulationStore((s) => s.simulationConfigs);
  const receivers = useReceiversStore((s) => s.receivers);
  const gridListeners = useGridListenersStore((s) => s.gridListeners);
  const share = useShareConfigStore();
  const link = useShareLink(isReadOnly ? null : modelId);
  const [copied, setCopied] = useState<"link" | "embed" | null>(null);
  const [confirm, setConfirm] = useState<"regenerate" | "revoke" | null>(null);

  const items = useMemo<Record<ShareItemKind, ShareItem[]>>(() => ({
    scene: scenes.filter((s) => s.sceneId).map((s) => ({ id: s.sceneId, label: s.title })),
    simulation: simulationConfigs.map((c) => ({ id: c.id, label: c.display_name || c.id })),
    listener: [
      ...receivers.map((r) => ({ id: r.id, label: r.name })),
      ...gridListeners.map((g) => ({ id: g.id, label: g.name })),
    ],
  }), [scenes, simulationConfigs, receivers, gridListeners]);

  // Only shared items can be linked.
  const sharedItems = useMemo<Record<ShareItemKind, ShareItem[]>>(() => ({
    scene: items.scene.filter((i) => share.sceneIds.includes(i.id)),
    simulation: items.simulation.filter((i) => share.simulationIds.includes(i.id)),
    listener: items.listener.filter((i) => share.listenerIds.includes(i.id)),
  }), [items, share.sceneIds, share.simulationIds, share.listenerIds]);

  if (!modelId) return <EmptyState message={SHARE_SETTINGS.NO_MODEL} />;
  if (isReadOnly) return <EmptyState message={SHARE_SETTINGS.OWNER_ONLY} />;

  const copy = async (kind: "link" | "embed") => {
    if (!link.shareUrl) return;
    await navigator.clipboard.writeText(kind === "link" ? link.shareUrl : shareEmbedCode(link.shareUrl));
    setCopied(kind);
    setTimeout(() => setCopied(null), SHARE_SETTINGS.COPIED_RESET_MS);
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[10px] leading-snug text-secondary-hover">{SHARE_SETTINGS.INTRO}</p>

      <ShareItemChecklist
        title={SHARE_SETTINGS.SCENES}
        items={items.scene}
        selected={share.sceneIds}
        disabled={false}
        onToggle={(id, next) => share.toggleItem("scene", id, next)}
      />
      <ShareItemChecklist
        title={SHARE_SETTINGS.SIMULATIONS}
        items={items.simulation}
        selected={share.simulationIds}
        disabled={false}
        onToggle={(id, next) => share.toggleItem("simulation", id, next)}
      />
      <ShareItemChecklist
        title={SHARE_SETTINGS.LISTENERS}
        items={items.listener}
        selected={share.listenerIds}
        disabled={false}
        onToggle={(id, next) => share.toggleItem("listener", id, next)}
      />

      <div className="flex flex-col gap-1">
        <span className={HEADING_CLASS}>{SHARE_SETTINGS.LINKS}</span>
        <span className="text-[10px] leading-snug text-secondary-hover">{SHARE_SETTINGS.LINKS_HINT}</span>
        <ShareLinkBoard items={sharedItems} links={share.links} />
      </div>

      {confirm ? (
        <ConfirmDialog
          message={confirm === "revoke" ? SHARE_SETTINGS.REVOKE_CONFIRM : SHARE_SETTINGS.REGENERATE_CONFIRM}
          confirmLabel={confirm === "revoke" ? SHARE_SETTINGS.REVOKE : SHARE_SETTINGS.REGENERATE}
          variant="danger"
          disabled={link.busy}
          onConfirm={() => {
            void (confirm === "revoke" ? link.revoke() : link.regenerate()).finally(() => setConfirm(null));
          }}
          onCancel={() => setConfirm(null)}
        />
      ) : link.shareUrl ? (
        <div className="flex flex-col gap-1.5">
          <input
            readOnly
            value={link.shareUrl}
            aria-label="Share link"
            onFocus={(e) => e.currentTarget.select()}
            className="w-full px-2 py-1 text-[10px] rounded bg-secondary-lighter text-foreground border border-secondary-light focus:outline-none"
            style={{ borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
          />
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => void copy("link")}
              className={ACTION_CLASS}
              style={{ background: "var(--color-primary)", color: "var(--color-on-blue)", borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
            >
              {copied === "link" ? <Check size={11} /> : <Link2 size={11} />}
              {copied === "link" ? SHARE_SETTINGS.COPIED : SHARE_SETTINGS.COPY_LINK}
            </button>
            <button
              type="button"
              onClick={() => void copy("embed")}
              className={ACTION_CLASS}
              style={{ background: "var(--color-secondary-lighter)", color: "var(--color-foreground)", borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
            >
              {copied === "embed" ? <Check size={11} /> : <Code2 size={11} />}
              {copied === "embed" ? SHARE_SETTINGS.COPIED : SHARE_SETTINGS.COPY_EMBED}
            </button>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={link.busy}
              onClick={() => setConfirm("regenerate")}
              className={ACTION_CLASS}
              style={{ color: "var(--color-secondary-hover)", borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
            >
              <RefreshCw size={11} />
              {SHARE_SETTINGS.REGENERATE}
            </button>
            <button
              type="button"
              disabled={link.busy}
              onClick={() => setConfirm("revoke")}
              className={ACTION_CLASS}
              style={{ color: "var(--color-error)", borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
            >
              <Unlink size={11} />
              {SHARE_SETTINGS.REVOKE}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={link.busy}
          onClick={() => void link.create()}
          className={ACTION_CLASS}
          style={{ background: "var(--color-primary)", color: "var(--color-on-blue)", borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
        >
          <Link2 size={11} />
          {SHARE_SETTINGS.CREATE}
        </button>
      )}
    </div>
  );
}
