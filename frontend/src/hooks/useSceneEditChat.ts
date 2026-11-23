'use client';

import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAnalysisStore, useSceneEditStore, useSceneWorkflowStore, useSoundscapeStore } from '@/store';
import type { SceneChatMessage, SceneEditTurn } from '@/types/sceneEdit';
import { getSceneSoundIndices, isSoundConfigGenerated } from '@/utils/sceneWorkflow';
import { useCanEdit } from '@/hooks/useCanEdit';

const NO_MESSAGES: SceneChatMessage[] = [];

export interface SceneEditChatState {
  messages: SceneChatMessage[];
  /** Running turn of this scene, or null. */
  turn: SceneEditTurn | null;
  /** The scene has generated sounds to edit. */
  ready: boolean;
  /** A message can be sent now. */
  canSend: boolean;
  /** The viewer may edit (false in the public share view). */
  canEdit: boolean;
}

/**
 * Scene edit chat of scene `usageIndex`: its persisted thread, the running turn,
 * and send / cancel.
 *
 * Usage:
 * ```tsx
 * const { state, send, cancel } = useSceneEditChat(usageIndex);
 * ```
 */
export function useSceneEditChat(usageIndex: number) {
  const canEdit = useCanEdit();
  const { sceneId, messages } = useAnalysisStore(
    useShallow((s) => {
      const cfg = s.analysisConfigs[usageIndex];
      return cfg?.type === 'scenario'
        ? { sceneId: cfg.scene_id ?? null, messages: cfg.editChat ?? NO_MESSAGES }
        : { sceneId: null, messages: NO_MESSAGES };
    }),
  );
  const turn = useSceneEditStore((s) => (sceneId ? s.turns[sceneId] ?? null : null));
  const workflowRunning = useSceneWorkflowStore((s) => s.runs[usageIndex]?.status === 'running');
  const ready = useSoundscapeStore((s) =>
    getSceneSoundIndices(s.soundConfigs, usageIndex).some((i) =>
      isSoundConfigGenerated(s.soundConfigs, s.generatedSounds, i),
    ),
  );

  const send = useCallback(
    (text: string) => useSceneEditStore.getState().sendTurn(usageIndex, text),
    [usageIndex],
  );
  const cancel = useCallback(() => {
    if (sceneId) useSceneEditStore.getState().cancelTurn(sceneId);
  }, [sceneId]);

  const state: SceneEditChatState = {
    messages,
    turn,
    ready,
    canEdit,
    canSend: canEdit && ready && !turn && !workflowRunning && !!sceneId,
  };
  return { state, send, cancel };
}
