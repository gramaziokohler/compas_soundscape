import { useEffect } from 'react';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { useUIStore } from '@/store';
import { getLiveSoundPosition } from '@/lib/three/sound-live-position';
import { FPS_FACE_SOURCE_DURATION_MS } from '@/utils/constants';
import type { SoundEvent } from '@/types';

/**
 * First-person mode (edit and share view): a sound focused from a sound card (expanded) or
 * a DAW track (clicked) turns the listener's view toward that sound's source.
 * The listener never moves. A focus from the scene itself (sphere / linked object
 * click) does not turn: the source is already where the user is looking.
 *
 * Usage (once, in SpeckleScene):
 * ```ts
 * useFaceFocusedSound(soundscapeData);
 * ```
 */
export function useFaceFocusedSound(soundscapeData: SoundEvent[] | null): void {
  const soundFocus = useUIStore((s) => s.soundFocus);

  useEffect(() => {
    if (!soundFocus || soundFocus.source === 'scene') return;
    // The camera controller is the FPS source of truth (speckleEngineStore.isFirstPersonMode
    // is never written; useSpeckleFPS keeps its own React state).
    const { coordinator } = useSpeckleEngineStore.getState();
    if (!coordinator?.isFirstPersonMode()) return;
    const target = getLiveSoundPosition(coordinator.getSoundSphereManager(), soundFocus.index, soundscapeData);
    if (target) coordinator.faceFirstPersonToward(target, FPS_FACE_SOURCE_DURATION_MS);
  }, [soundFocus?.version]); // eslint-disable-line react-hooks/exhaustive-deps
}
