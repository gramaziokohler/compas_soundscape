'use client';

import { ReceiverData } from '@/types';
import { ReceiversSection } from './ReceiversSection';

/**
Receivers display and management tab within the 3D Models sidebar.
 */

export interface ReceiversTabProps {
receivers?: ReceiverData[];
  // Receiver management
onAddReceiver?: (type: string) => void;
onDeleteReceiver?: (id: string) => void;
onUpdateReceiverName?: (id: string, name: string) => void;
onGoToReceiver?: (id: string) => void;
onAddGridReceiver?: (type: string, n: number) => void;
}


export function ReceiversTab({
  receivers = [],
  onAddReceiver,
  onDeleteReceiver,
  onUpdateReceiverName,
  onGoToReceiver,
  onAddGridReceiver

}: ReceiversTabProps) {
  return (
    <div className="flex flex-col gap-3">
      {/* Receivers Section */}
      {onAddReceiver && onDeleteReceiver && onUpdateReceiverName && onGoToReceiver && onAddGridReceiver &&(
        <ReceiversSection
          receivers={receivers}
          onAddReceiver={onAddReceiver}
          onDeleteReceiver={onDeleteReceiver}
          onUpdateReceiverName={onUpdateReceiverName}
          onGoToReceiver={onGoToReceiver}
          onAddGridReceiver={onAddGridReceiver}
        />
      )}
    </div>
  );
}
