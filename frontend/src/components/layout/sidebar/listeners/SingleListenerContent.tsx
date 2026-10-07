'use client';

import type { ReceiverData } from '@/types/receiver';
import { PositionWidget } from '@/components/ui/PositionWidget';
import { FpsLockedNotice } from './FpsLockedNotice';
import { ListenerOrientationWidget } from './ListenerOrientationWidget';

interface SingleListenerContentProps {
  receiver: ReceiverData;
  color: string;
  onUpdatePosition: (id: string, position: [number, number, number]) => void;
  /** True while this listener is powered (viewer locked in its FPS view). */
  isPowered: boolean;
}

export function SingleListenerContent({ receiver, color, onUpdatePosition, isPowered }: SingleListenerContentProps) {
  return (
    <div className="card-stack text-xs text-secondary-hover">
      {isPowered && <FpsLockedNotice />}
      <PositionWidget
        position={receiver.position}
        onUpdatePosition={(pos) => onUpdatePosition(receiver.id, pos)}
      />
      <ListenerOrientationWidget receiver={receiver} color={color} isPowered={isPowered} />
    </div>
  );
}
