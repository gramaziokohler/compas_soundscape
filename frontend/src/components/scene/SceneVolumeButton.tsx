'use client';

import { useCallback, useState } from 'react';
import { BarButton } from '@/components/ui/BarButton';
import { VerticalVolumeSlider } from '@/components/ui/VerticalVolumeSlider';
import { Icon } from '@/components/ui/Icon';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';

const DEFAULT_MASTER_VOLUME = 0.8;

interface SceneVolumeButtonProps {
  audioOrchestrator: AudioOrchestrator | null;
}

/**
 * Master volume for the scene bottom bar: click toggles mute, hover reveals a
 * vertical slider above the bar.
 */
export function SceneVolumeButton({ audioOrchestrator }: SceneVolumeButtonProps) {
  const [volume, setVolume] = useState(DEFAULT_MASTER_VOLUME);
  const [isHovering, setIsHovering] = useState(false);

  const handleChange = useCallback((value: number) => {
    setVolume(value);
    audioOrchestrator?.setMasterVolume(value);
  }, [audioOrchestrator]);

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
        onClick={() => handleChange(muted ? DEFAULT_MASTER_VOLUME : 0)}
        warning={muted}
        title={muted ? 'Unmute' : 'Master volume (click to mute)'}
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
