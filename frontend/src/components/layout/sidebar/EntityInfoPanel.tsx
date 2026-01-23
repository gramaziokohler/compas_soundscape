'use client';

import { UI_COLORS, SPECKLE_FILTER_COLORS } from '@/lib/constants';
import { useSpeckleSelectionMode } from '@/contexts/SpeckleSelectionModeContext';

/**
 * EntityInfoPanel Component
 *
 * Embedded version of EntityInfoBox for display in RightSidebar.
 * Shows entity information and allows toggling diverse selection.
 *
 * This component reads the selected entity from SpeckleSelectionModeContext
 * and displays its information in a fixed panel.
 */
export function EntityInfoPanel() {
  const {
    selectedEntity,
    linkVersion,
    getObjectLinkState,
    addToDiverseSelection,
    removeFromDiverseSelection
  } = useSpeckleSelectionMode();

  // If no entity selected, show placeholder
  if (!selectedEntity) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-4">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-12 w-12 mb-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          style={{ color: UI_COLORS.NEUTRAL_500 }}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"
          />
        </svg>
        <p className="text-sm" style={{ color: UI_COLORS.NEUTRAL_500 }}>
          Click on an object in the 3D view to see its details
        </p>
      </div>
    );
  }

  // Get current state for this object (re-query on linkVersion change)
  const { isLinked, isDiverse, linkedSoundIndex } = getObjectLinkState(selectedEntity.objectId);

  // Link button config - simplified, no tab dependency
  const getLinkButtonConfig = () => {
    if (isLinked) {
      return {
        color: SPECKLE_FILTER_COLORS.SOUND_LINKED,
        hoverColor: SPECKLE_FILTER_COLORS.SOUND_LINKED,
        title: `Linked to Sound #${linkedSoundIndex! + 1} (unlink from Sound tab)`,
        action: () => {}
      };
    } else if (isDiverse) {
      return {
        color: SPECKLE_FILTER_COLORS.DIVERSE_SELECTION,
        hoverColor: UI_COLORS.PRIMARY_HOVER,
        title: 'Remove from diverse selection',
        action: () => removeFromDiverseSelection(selectedEntity.objectId)
      };
    } else {
      return {
        color: UI_COLORS.NEUTRAL_500,
        hoverColor: UI_COLORS.NEUTRAL_600,
        title: 'Add to diverse selection',
        action: () => addToDiverseSelection(selectedEntity.objectId)
      };
    }
  };

  const linkButtonConfig = getLinkButtonConfig();

  return (
    <div className="h-full flex flex-col">
      {/* Entity Title with action button */}
      <div
        className="pb-2 mb-3 text-sm font-semibold flex items-center justify-between"
        style={{
          borderBottom: `1px solid ${UI_COLORS.NEUTRAL_700}`,
          color: UI_COLORS.NEUTRAL_700
        }}
      >
        <span>Entity Information</span>

        {/* Link button - toggles diverse selection */}
        <button
          onClick={linkButtonConfig.action}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = `${linkButtonConfig.hoverColor}20`;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
          disabled={isLinked}
          className="w-7 h-7 flex items-center justify-center rounded-full transition-colors"
          style={{
            backgroundColor: 'transparent',
            color: linkButtonConfig.color,
            opacity: isLinked ? 0.6 : 1,
            cursor: isLinked ? 'not-allowed' : 'pointer'
          }}
          title={linkButtonConfig.title}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        </button>
      </div>

      {/* Entity Details */}
      <div className="space-y-2 text-sm flex-1">
        <div className="flex justify-between">
          <span style={{ color: UI_COLORS.NEUTRAL_500 }}>Type:</span>
          <span style={{ color: UI_COLORS.NEUTRAL_700 }}>{selectedEntity.objectType}</span>
        </div>

        {selectedEntity.objectName && (
          <div className="flex justify-between">
            <span style={{ color: UI_COLORS.NEUTRAL_500 }}>Name:</span>
            <span
              className="text-right max-w-[180px] truncate"
              style={{ color: UI_COLORS.NEUTRAL_700 }}
              title={selectedEntity.objectName}
            >
              {selectedEntity.objectName}
            </span>
          </div>
        )}

        {selectedEntity.parentName && (
          <div className="flex justify-between">
            <span style={{ color: UI_COLORS.NEUTRAL_500 }}>Parent:</span>
            <span
              className="text-right max-w-[180px] truncate"
              style={{ color: UI_COLORS.NEUTRAL_700 }}
              title={selectedEntity.parentName}
            >
              {selectedEntity.parentName}
            </span>
          </div>
        )}

        {selectedEntity.objectId && (
          <div className="flex justify-between">
            <span style={{ color: UI_COLORS.NEUTRAL_500 }}>Object ID:</span>
            <span
              className="text-right max-w-[180px] truncate"
              style={{ color: UI_COLORS.NEUTRAL_700 }}
              title={selectedEntity.objectId}
            >
              {selectedEntity.objectId}
            </span>
          </div>
        )}

        {/* Linked Sound Information */}
        {isLinked && linkedSoundIndex !== undefined && (
          <div className="pt-2 mt-2" style={{ borderTop: `1px solid ${UI_COLORS.NEUTRAL_200}` }}>
            <div className="flex justify-between items-center">
              <span style={{ color: UI_COLORS.NEUTRAL_500 }}>Linked to:</span>
              <span className="font-medium" style={{ color: SPECKLE_FILTER_COLORS.SOUND_LINKED }}>
                Sound #{linkedSoundIndex + 1}
              </span>
            </div>
          </div>
        )}

        {/* Diverse Selection Information */}
        {isDiverse && !isLinked && (
          <div className="pt-2 mt-2" style={{ borderTop: `1px solid ${UI_COLORS.NEUTRAL_200}` }}>
            <div className="flex justify-between items-center">
              <span style={{ color: UI_COLORS.NEUTRAL_500 }}>Status:</span>
              <span className="font-medium" style={{ color: SPECKLE_FILTER_COLORS.DIVERSE_SELECTION }}>
                Diverse Selection
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
