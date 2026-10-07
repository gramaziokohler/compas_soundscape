import { useEffect, useRef, type MutableRefObject } from 'react';
import type { CameraController } from '@speckle/viewer';
import { registerShortcutTarget } from '@/lib/shortcuts/shortcut-targets';
import { useSpeckleStore } from '@/store';

interface UseSceneShortcutTargetsParams {
  /** Timeline has at least one sound to play. */
  hasTimeline: boolean;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  seekTo: (timeMs: number) => void;
  cameraControllerRef: MutableRefObject<CameraController | null>;
  /** Frames the whole model (bottom-bar reset zoom). */
  onResetZoom: () => void;
}

/**
 * Publishes SpeckleScene's DAW transport and camera framing to the keyboard
 * shortcut registry (Space / Shift+Space / Home / F). Registered once; reads
 * the latest values through a ref so re-renders never re-register.
 */
export function useSceneShortcutTargets(params: UseSceneShortcutTargetsParams): void {
  const latest = useRef(params);
  latest.current = params;

  useEffect(() => {
    const unregisterTimeline = registerShortcutTarget('timeline', {
      canToggle: () => latest.current.hasTimeline,
      toggle: () => {
        const p = latest.current;
        if (p.isPlaying) p.onPause();
        else p.onPlay();
      },
      stop: () => latest.current.onStop(),
      rewind: () => latest.current.seekTo(0),
    });

    const unregisterViewer = registerShortcutTarget('viewer', {
      frameSelection: () => {
        const ids = useSpeckleStore.getState().selectedObjectIds;
        const camera = latest.current.cameraControllerRef.current;
        if (ids.length > 0 && camera) {
          camera.setCameraView(ids, true);
        } else {
          latest.current.onResetZoom();
        }
      },
    });

    return () => {
      unregisterTimeline();
      unregisterViewer();
    };
  }, []);
}
