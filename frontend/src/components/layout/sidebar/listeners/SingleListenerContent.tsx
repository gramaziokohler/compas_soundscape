'use client';

import type { ReceiverData } from '@/types/receiver';

interface SingleListenerContentProps {
  receiver: ReceiverData;
  color: string;
  onUpdatePosition: (id: string, axis: 0 | 1 | 2, raw: string, currentPos: [number, number, number]) => void;
}

export function SingleListenerContent({ receiver, color, onUpdatePosition }: SingleListenerContentProps) {
  const [x, y, z] = receiver.position;

  return (
    <div className="text-xs text-secondary-hover">
      <div className="font-medium mb-1.5" style={{ color }}>Position</div>
      <div className="flex gap-2">
        {(['x', 'y', 'z'] as const).map((axis, axisIdx) => {
          const val = [x, y, z][axisIdx];
          return (
            <div key={axis} className="flex-1 flex flex-col gap-0.5">
              <span className="text-[10px] font-medium text-secondary-hover uppercase">{axis}</span>
              <input
                type="number"
                step="0.1"
                value={parseFloat(val.toFixed(3))}
                onChange={(e) => onUpdatePosition(receiver.id, axisIdx as 0 | 1 | 2, e.target.value, receiver.position)}
                className="w-full text-[10px] font-mono rounded px-1.5 py-0.5 border outline-none focus:ring-1 bg-background text-foreground"
                style={{ borderColor: `${color}55` }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
