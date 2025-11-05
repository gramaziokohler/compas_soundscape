/**
 * AcousticsTab Component
 *
 * Combines Receivers and IR Library sections.
 * This component organizes acoustic-related features in the sidebar.
 *
 * Sections:
 * - Receivers: Create and manage receiver spheres
 * - IR Library: Upload, browse, and select impulse responses
 *
 * Architecture:
 * - Follows modular component pattern
 * - Delegates to specialized section components
 * - Maintains consistent styling with other tabs
 */

import { ReceiversSection } from './ReceiversSection';
import { ImpulseResponseUpload } from '@/components/audio/ImpulseResponseUpload';
import type { ReceiverData } from '@/types';
import type { ImpulseResponseMetadata } from '@/types/audio';
import type { AuralizationConfig } from '@/hooks/useAuralization';
import { UI_COLORS } from '@/lib/constants';

interface AcousticsTabProps {
  // Receiver props
  receivers: ReceiverData[];
  isPlacingReceiver: boolean;
  onStartPlacingReceiver: () => void;
  onDeleteReceiver: (id: string) => void;
  onUpdateReceiverName: (id: string, name: string) => void;

  // IR Library props
  onSelectIRFromLibrary: (irMetadata: ImpulseResponseMetadata) => Promise<void>;
  onClearIR: () => void;
  onToggleNormalize: (enabled: boolean) => void;
  selectedIRId: string | null;
  auralizationConfig: AuralizationConfig;
}

export function AcousticsTab({
  receivers,
  isPlacingReceiver,
  onStartPlacingReceiver,
  onDeleteReceiver,
  onUpdateReceiverName,
  onSelectIRFromLibrary,
  onClearIR,
  onToggleNormalize,
  selectedIRId,
  auralizationConfig
}: AcousticsTabProps) {
  return (
    <div className="flex flex-col gap-6">
      {/* Receivers Section */}
      <ReceiversSection
        receivers={receivers}
        isPlacingReceiver={isPlacingReceiver}
        onStartPlacingReceiver={onStartPlacingReceiver}
        onDeleteReceiver={onDeleteReceiver}
        onUpdateReceiverName={onUpdateReceiverName}
      />

      {/* IR Library Management */}
      <div className="flex flex-col gap-3">
        <h4 className="text-xs font-semibold" style={{ color: UI_COLORS.NEUTRAL_700 }}>
          IMPULSE RESPONSE LIBRARY
        </h4>
        <ImpulseResponseUpload
          onSelectIR={onSelectIRFromLibrary}
          onClearIR={onClearIR}
          onToggleNormalize={onToggleNormalize}
          selectedIRId={selectedIRId}
          auralizationConfig={auralizationConfig}
        />
      </div>
    </div>
  );
}
