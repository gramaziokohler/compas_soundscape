'use client';

import { Notice } from '@/components/ui/Notice';

/** Card notice shown while the viewer is locked in a listener's first-person view. */
export function FpsLockedNotice() {
  return (
    <div>
      <Notice
        type="warning"
        message="Viewer in locked FPS viewmode. Press Esc or turn off the power button to exit."
      />
    </div>
  );
}
