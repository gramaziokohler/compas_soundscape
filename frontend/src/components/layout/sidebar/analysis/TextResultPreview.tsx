'use client';

import { useEffect } from 'react';
import type { TextPromptResult } from '@/types/analysis';
import { useAnalysisPreviewStore, useSpeckleStore } from '@/store';
import { buildEntityFromObjectId } from '@/lib/three/speckle-entity-utils';

/**
 * Publishes the text-card result phase to the 3D scene while the card is
 * expanded:
 *   - selected linked analysis groups → object ids (highlighted scenario-style),
 *   - a label sprite over the FIRST linked object of each linked prompt,
 *   - preview spheres for selected unlinked prompts.
 *
 * Deselecting a prompt removes its label / object highlight. Renders nothing;
 * mounts only while the card's after-content is visible.
 */
export function TextResultPreview({
  configIndex,
  prompts,
}: {
  configIndex: number;
  prompts: TextPromptResult[];
}) {
  useEffect(() => {
    useAnalysisPreviewStore.getState().setExpandedTextCard(configIndex);
    return () => {
      const store = useAnalysisPreviewStore.getState();
      if (store.expandedTextCardIndex === configIndex) {
        store.setExpandedTextCard(null);
      }
    };
  }, [configIndex]);

  useEffect(() => {
    const objectIds = new Set<string>();
    const points: Array<{
      promptId: string;
      position: [number, number, number];
      label: string;
      showSphere?: boolean;
    }> = [];

    let worldTree: any = null;
    try {
      worldTree = useSpeckleStore.getState().getViewerRef()?.getWorldTree?.() ?? null;
    } catch {
      /* ignore */
    }

    const entityObjectIds = (e: any): string[] =>
      Array.isArray(e?.object_ids) && e.object_ids.length > 0
        ? e.object_ids
        : e?.id
          ? [e.id]
          : e?.nodeId
            ? [e.nodeId]
            : [];

    for (const p of prompts) {
      if (!p.selected) continue;
      const ents = (p.entities ?? (p.entity ? [p.entity] : [])) as any[];
      const label = p.displayName || p.text;

      if (ents.length > 0) {
        // Highlight every object in every linked group.
        let firstLinkedId: string | undefined;
        for (const e of ents) {
          const ids = entityObjectIds(e);
          for (const id of ids) {
            objectIds.add(id);
            if (!firstLinkedId) firstLinkedId = id;
          }
        }

        // Label sprite over the first linked object.
        let position: [number, number, number] | undefined;
        if (worldTree && firstLinkedId) {
          const resolved = buildEntityFromObjectId(worldTree, firstLinkedId, []);
          if (resolved?.position && resolved.position.some((v) => v !== 0)) {
            position = resolved.position as [number, number, number];
          }
        }
        if (!position) {
          const first = ents[0];
          if (first?.bounds?.center) {
            position = [first.bounds.center[0], first.bounds.center[1], first.bounds.center[2]];
          } else if (Array.isArray(first?.position) && first.position.length >= 3) {
            position = [first.position[0], first.position[1], first.position[2]];
          }
        }
        if (position) {
          points.push({ promptId: p.id, position, label, showSphere: false });
        }
      } else if (p.position) {
        points.push({ promptId: p.id, position: p.position, label, showSphere: true });
      }
    }

    useAnalysisPreviewStore.getState().setPreview({
      cardIndex: configIndex,
      objectIds: [...objectIds],
      points,
    });

    return () => useAnalysisPreviewStore.getState().clearPreview();
  }, [configIndex, prompts]);

  return null;
}
