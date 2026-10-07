'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import {
  Copy, Ear, EyeOff, Focus, Funnel, FunnelX, Headphones, ListTree,
  PanelLeft, PanelRight, Volume2, VolumeX, X,
} from 'lucide-react';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/ActionMenu';
import { useAudioControlsStore, useSpeckleStore } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { notifyError } from '@/store/errorsStore';
import { KEYBOARD_SHORTCUTS } from '@/utils/constants';
import type { ContextMenuHit } from '@/lib/three/speckle-event-bridge';
import type { SoundEvent } from '@/types';
import {
  canIsolateSelection,
  fitSelectionToView,
  getSelectionApplicationId,
  getSelectionLeafIds,
  hideSelection,
  isSelectionIsolated,
  toggleIsolateSelection,
} from '@/lib/three/speckle-selection-actions';

interface SceneContextMenuProps {
  x: number;
  y: number;
  /** What the right-click selected (model objects, a sound sphere or a listener). */
  hit: ContextMenuHit;
  onClose: () => void;
  /** Open the Object Explorer panel. */
  onOpenExplorer: () => void;
  /** Expand the sound's card in the left sidebar. */
  onRevealSound?: (promptIndex: number) => void;
  /** Expand the listener's card in the right sidebar. */
  onRevealListener?: (receiverId: string) => void;
  /** Enter first-person view at the listener. */
  onEnterListener?: (receiverId: string) => void;
}

function copyToClipboard(text: string): void {
  navigator.clipboard.writeText(text).catch(() => {
    notifyError('Could not copy to the clipboard', 'warning');
  });
}

function clearSelection(): void {
  useSpeckleEngineStore.getState().coordinator?.getEventBridge()?.clearSelection();
  useSpeckleStore.getState().clearViewerSelection();
}

function zoomToObject(object: THREE.Object3D): void {
  const coordinator = useSpeckleEngineStore.getState().coordinator;
  coordinator?.zoomToPosition(object.getWorldPosition(new THREE.Vector3()));
}

const SEPARATOR: ActionMenuItem = { kind: 'separator', key: 'sep' };
const CLEAR_ITEM: ActionMenuItem = {
  kind: 'action',
  key: 'clear',
  label: 'Clear selection',
  icon: X,
  shortcut: KEYBOARD_SHORTCUTS.COLLAPSE.keys,
  onSelect: clearSelection,
};

/**
 * SceneContextMenu
 *
 * Right-click command menu for the 3D viewer. The right-click has already
 * selected the target (SpeckleEventBridge.selectForContextMenu); this menu acts
 * on that selection:
 *  - Model objects: Hide · Isolate · Reveal in explorer · Fit to view · Copy application ID
 *  - Sound spheres: Mute · Solo · Reveal in sidebar · Fit to view · Copy sound ID
 *  - Listeners:     Listen from here · Reveal in sidebar · Fit to view · Copy listener ID
 * followed by Clear selection.
 */
export function SceneContextMenu({
  x,
  y,
  hit,
  onClose,
  onOpenExplorer,
  onRevealSound,
  onRevealListener,
  onEnterListener,
}: SceneContextMenuProps) {
  const mutedSounds = useAudioControlsStore((s) => s.mutedSounds);
  const soloedSounds = useAudioControlsStore((s) => s.soloedSounds);

  const items = useMemo<ActionMenuItem[]>(() => {
    if (hit.kind === 'speckle') {
      const leafIds = getSelectionLeafIds(hit.objectIds);
      const isolated = isSelectionIsolated(leafIds);
      const applicationId = getSelectionApplicationId();
      return [
        {
          kind: 'action', key: 'hide', label: 'Hide', icon: EyeOff,
          shortcut: KEYBOARD_SHORTCUTS.HIDE_SELECTION.keys,
          onSelect: hideSelection,
        },
        ...(canIsolateSelection()
          ? [{
              kind: 'action' as const, key: 'isolate',
              label: isolated ? 'Unisolate' : 'Isolate',
              icon: isolated ? FunnelX : Funnel,
              onSelect: toggleIsolateSelection,
            }]
          : []),
        {
          kind: 'action', key: 'reveal', label: 'Reveal in explorer', icon: ListTree,
          onSelect: () => {
            onOpenExplorer();
            // New array identity re-runs the explorer's expand + scroll-to-selection.
            useSpeckleStore.getState().setSelectedObjectIds([...hit.objectIds]);
          },
        },
        { kind: 'action', key: 'fit', label: 'Fit to view', icon: Focus, onSelect: fitSelectionToView },
        {
          kind: 'action', key: 'copy', label: 'Copy application ID', icon: Copy,
          disabled: !applicationId,
          onSelect: () => { if (applicationId) copyToClipboard(applicationId); },
        },
        SEPARATOR,
        CLEAR_ITEM,
      ];
    }

    const { object } = hit;

    if (hit.kind === 'sound') {
      const soundEvent = object.userData.soundEvent as SoundEvent | undefined;
      const soundId = soundEvent?.id;
      const promptKey = object.userData.promptKey as string | undefined;
      const promptIndex = promptKey ? parseInt(promptKey.replace('prompt_', ''), 10) : NaN;
      const muted = !!soundId && mutedSounds.has(soundId);
      const soloed = !!soundId && soloedSounds.has(soundId);
      return [
        {
          kind: 'action', key: 'mute', label: muted ? 'Unmute' : 'Mute',
          icon: muted ? Volume2 : VolumeX, disabled: !soundId,
          onSelect: () => { if (soundId) useAudioControlsStore.getState().handleMute(soundId); },
        },
        {
          kind: 'action', key: 'solo', label: soloed ? 'Unsolo' : 'Solo',
          icon: Headphones, disabled: !soundId,
          onSelect: () => { if (soundId) useAudioControlsStore.getState().handleSolo(soundId); },
        },
        {
          kind: 'action', key: 'reveal', label: 'Reveal in sidebar', icon: PanelLeft,
          disabled: isNaN(promptIndex) || !onRevealSound,
          onSelect: () => onRevealSound?.(promptIndex),
        },
        { kind: 'action', key: 'fit', label: 'Fit to view', icon: Focus, onSelect: () => zoomToObject(object) },
        {
          kind: 'action', key: 'copy', label: 'Copy sound ID', icon: Copy, disabled: !soundId,
          onSelect: () => { if (soundId) copyToClipboard(soundId); },
        },
        SEPARATOR,
        CLEAR_ITEM,
      ];
    }

    const receiverId = object.userData.receiverId as string | undefined;
    return [
      {
        kind: 'action', key: 'listen', label: 'Listen from here', icon: Ear,
        disabled: !receiverId || !onEnterListener,
        onSelect: () => { if (receiverId) onEnterListener?.(receiverId); },
      },
      {
        kind: 'action', key: 'reveal', label: 'Reveal in sidebar', icon: PanelRight,
        disabled: !receiverId || !onRevealListener,
        onSelect: () => { if (receiverId) onRevealListener?.(receiverId); },
      },
      { kind: 'action', key: 'fit', label: 'Fit to view', icon: Focus, onSelect: () => zoomToObject(object) },
      {
        kind: 'action', key: 'copy', label: 'Copy listener ID', icon: Copy, disabled: !receiverId,
        onSelect: () => { if (receiverId) copyToClipboard(receiverId); },
      },
      SEPARATOR,
      CLEAR_ITEM,
    ];
  }, [hit, mutedSounds, soloedSounds, onOpenExplorer, onRevealSound, onRevealListener, onEnterListener]);

  return <ActionMenu x={x} y={y} items={items} onClose={onClose} />;
}
