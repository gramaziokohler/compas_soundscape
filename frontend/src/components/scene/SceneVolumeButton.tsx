'use client';

import { useEffect, useState } from 'react';
import { BarButton } from '@/components/ui/BarButton';
import { VerticalVolumeSlider } from '@/components/ui/VerticalVolumeSlider';
import { Icon } from '@/components/ui/Icon';
import { useAudioControlsStore } from '@/store';
import { AUDIO_CONTROL } from '@/utils/constants';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';

const DEFAULT_MASTER_VOLUME = AUDIO_CONTROL.MASTER_VOLUME.RESET;

interface SceneVolumeButtonProps {
  audioOrchestrator: AudioOrchestrator | null;
}

/**
 * Master volume for the scene bottom bar: click toggles mute, hover reveals a
 * vertical slider above the bar. The value lives in audioControlsStore so other
 * UI (e.g. the low-output hints) can change it; this component mirrors it onto
 * the AudioOrchestrator.
 */
export function SceneVolumeButton({ audioOrchestrator }: SceneVolumeButtonProps) {
  const volume = useAudioControlsStore((s) => s.masterVolume);
  const handleChange = useAudioControlsStore((s) => s.setMasterVolume);
  const toggleMute = useAudioControlsStore((s) => s.toggleMasterMute);
  const [isHovering, setIsHovering] = useState(false);

  useEffect(() => {
    audioOrchestrator?.setMasterVolume(volume);
  }, [audioOrchestrator, volume]);

  const muted = volume === 0;

  return (
    <div
      className="relative flex items-center"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {isHovering && (
        <div
          data-volume-slider
          className="absolute bottom-full pb-2 flex items-center justify-center"
          style={{ left: '50%', transform: 'translateX(-50%)' }}
        >
          <VerticalVolumeSlider value={volume} onChange={handleChange} defaultValue={DEFAULT_MASTER_VOLUME} precision={2} />
        </div>
      )}
      <BarButton
        onClick={toggleMute}
        warning={muted}
        title={muted ? 'Unmute' : 'Master volume (click to mute)'}
        shortcut="MUTE"
        icon={
          muted ? (
            <Icon>
              <path d="M11 5L6 9H2v6h4l5 4V5z" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </Icon>
          ) : (
            <Icon>
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </Icon>
          )
        }
      />
    </div>
  );
}
