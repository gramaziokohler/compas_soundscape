import { useCallback, useState } from 'react';
import { apiService } from '@/services/api';
import { useWorkspaceStore, selectIsReadOnlyWorkspace, notifyError } from '@/store';
import { SCENE_TRANSFER } from '@/utils/constants';
import type { SendScenesResponse, SendTargetEntry } from '@/types/sceneTransfer';

export interface UseSendScenesToModelOptions {
  /** Model / Homepage project id the scenes are copied from (the open one). */
  sourceModelId: string | null;
  /**
   * Save the open model so its soundscape.json matches what is on screen
   * (the backend reads the scenes from disk). Resolves false when it failed.
   */
  flushSave: () => Promise<boolean>;
}

export interface UseSendScenesToModelResult {
  isSending: boolean;
  error: string | null;
  /** Resolves the backend result, or null when nothing was sent. */
  send: (target: SendTargetEntry, usageIndices: number[], keepPositions: boolean) => Promise<SendScenesResponse | null>;
}

/**
 * Copies sound scenes from the open model into another model: of the same
 * workspace for its owner, of the user's own workspace otherwise. The open
 * model is saved first (owners), the send is posted, then the workspace
 * revision is re-baselined (the source itself did not change, so the next
 * autosave must not 409 and "Load latest" must not light up).
 *
 * Usage:
 * ```tsx
 * const { send, isSending, error } = useSendScenesToModel({ sourceModelId, flushSave });
 * await send(target, [usageIndex], false);
 * ```
 */
export function useSendScenesToModel({ sourceModelId, flushSave }: UseSendScenesToModelOptions): UseSendScenesToModelResult {
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (target: SendTargetEntry, usageIndices: number[], keepPositions: boolean) => {
      if (!sourceModelId || usageIndices.length === 0) return null;
      setIsSending(true);
      setError(null);
      try {
        // A non-owner cannot save the open (someone else's) workspace: the
        // owner's saved copy is the source.
        const readOnly = selectIsReadOnlyWorkspace(useWorkspaceStore.getState());
        if (!readOnly && !(await flushSave())) {
          setError(SCENE_TRANSFER.SAVE_FAILED);
          return null;
        }
        const result = await apiService.sendScenesToModel(sourceModelId, {
          target_model_id: target.modelId,
          usage_indices: usageIndices,
          keep_positions: keepPositions,
          target_project_id: target.projectId,
          target_version_id: target.versionId,
          // Speckle models are saved under their id (page.tsx save convention).
          target_model_name: target.isHome ? target.name : undefined,
          base_revision: useWorkspaceStore.getState().revision,
        });
        // Into the caller's own workspace the open workspace did not change.
        if (!result.cross_workspace) useWorkspaceStore.getState().setLoadedRevision(result.revision);
        return result;
      } catch (err) {
        const conflictRevision = (err as { conflictRevision?: number }).conflictRevision;
        if (conflictRevision !== undefined) {
          useWorkspaceStore.setState({ conflictRevision });
          notifyError(SCENE_TRANSFER.CONFLICT, 'warning');
          void useWorkspaceStore.getState().refresh();
          setError(SCENE_TRANSFER.CONFLICT);
          return null;
        }
        console.error('[useSendScenesToModel] Send failed:', err);
        setError(err instanceof Error ? err.message : 'Failed to send scenes');
        return null;
      } finally {
        setIsSending(false);
      }
    },
    [sourceModelId, flushSave],
  );

  return { isSending, error, send };
}
