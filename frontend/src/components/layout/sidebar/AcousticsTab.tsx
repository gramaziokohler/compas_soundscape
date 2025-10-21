/**
 * AcousticsTab Component
 *
 * Combines Receivers and Auralization sections into a single tab.
 * This component organizes acoustic-related features in the sidebar.
 *
 * Sections:
 * - Receivers: Create and manage receiver spheres
 * - Auralization: Apply impulse responses for room acoustics
 *
 * Architecture:
 * - Follows modular component pattern
 * - Delegates to specialized section components
 * - Maintains consistent styling with other tabs
 */

import { ReceiversSection } from './ReceiversSection';
import { AuralizationSection } from './AuralizationSection';
import type { ReceiverData } from '@/types';
import type { AuralizationConfig } from '@/hooks/useAuralization';

interface AcousticsTabProps {
  // Receiver props
  receivers: ReceiverData[];
  isPlacingReceiver: boolean;
  onStartPlacingReceiver: () => void;
  onDeleteReceiver: (id: string) => void;
  onUpdateReceiverName: (id: string, name: string) => void;

  // Auralization props
  auralizationConfig: AuralizationConfig;
  auralizationLoading: boolean;
  auralizationError: string | null;
  onToggleAuralization: (enabled: boolean) => void;
  onToggleNormalize: (normalize: boolean) => void;
  onLoadImpulseResponse: (file: File) => Promise<void>;
  onClearImpulseResponse: () => void;
}

export function AcousticsTab({
  receivers,
  isPlacingReceiver,
  onStartPlacingReceiver,
  onDeleteReceiver,
  onUpdateReceiverName,
  auralizationConfig,
  auralizationLoading,
  auralizationError,
  onToggleAuralization,
  onToggleNormalize,
  onLoadImpulseResponse,
  onClearImpulseResponse
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

      {/* Auralization Section - Direct content without wrapper */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Auralization
        </h3>
        <AuralizationSection
          config={auralizationConfig}
          isLoading={auralizationLoading}
          error={auralizationError}
          onToggleAuralization={onToggleAuralization}
          onToggleNormalize={onToggleNormalize}
          onLoadImpulseResponse={onLoadImpulseResponse}
          onClearImpulseResponse={onClearImpulseResponse}
        />
      </div>
    </div>
  );
}
