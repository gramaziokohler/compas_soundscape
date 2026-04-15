/**
 * SpeckleMaterialAssignmentUI Component
 *
 * Layer selector for acoustic simulations.
 * Material assignment tree has moved to EntityInfoPanel via AcousticMaterialContext.
 */

'use client';

import { UI_COLORS, UI_BORDER_RADIUS } from '@/utils/constants';
import type { SpeckleLayerInfo } from '@/types/speckle-materials';
import type { AcousticMaterial } from '@/types/materials';

interface SpeckleMaterialAssignmentUIProps {
  layerOptions: SpeckleLayerInfo[];
  selectedLayerId: string | null;
  availableMaterials: AcousticMaterial[];
  onSelectLayer?: (layerId: string) => void;
}

export function SpeckleMaterialAssignmentUI({
  layerOptions,
  selectedLayerId,
  availableMaterials,
  onSelectLayer
}: SpeckleMaterialAssignmentUIProps) {

  /**
   * Render layer selector dropdown
   */
  const renderLayerSelector = () => {
    if (layerOptions.length === 0) {
      return (
        <div
          className="px-3 py-2 text-xs"
          style={{
            color: UI_COLORS.NEUTRAL_500,
            fontStyle: 'italic'
          }}
        >
          No layers with mesh objects found
        </div>
      );
    }

    // Auto-selected "Acoustics" layer message
    const acousticsLayer = layerOptions.find(l => l.name.toLowerCase() === 'acoustics');
    const showAutoSelectedNote = acousticsLayer && selectedLayerId === acousticsLayer.id;

    return (
      <div>
        {showAutoSelectedNote && (
          <div
            className="px-2 py-1 text-xs text-success "
          >
            Auto-selected "Acoustics" layer
          </div>
        )}

        <select
          value={selectedLayerId || ''}
          onChange={(e) => onSelectLayer?.(e.target.value)}
          disabled={!onSelectLayer}
          className="w-full px-3 py-2 text-xs bg-info text-white border border-info rounded-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {layerOptions.map(layer => (
            <option key={layer.id} value={layer.id}>
              {layer.name} ({layer.meshCount} objects)
            </option>
          ))}
        </select>
      </div>
    );
  };

  return (
    <div>

        {renderLayerSelector()}

    </div>
  );
}
