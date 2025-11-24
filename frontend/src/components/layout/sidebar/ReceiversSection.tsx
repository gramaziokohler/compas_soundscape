/**
 * ReceiversSection Component
 *
 * UI component for managing acoustic receiver spheres.
 *
 * Features:
 * - Create new receiver button
 * - List of created receivers with inline name editing
 * - Delete individual receivers
 * - Position display (read-only, updated via dragging in 3D scene)
 *
 * Architecture:
 * - Follows existing sidebar section patterns
 * - Consistent styling with AuralizationSection
 * - Inline editing similar to SoundGenerationSection tabs
 */

import { useState } from 'react';
import type { ReceiverData } from '@/types';
import { UI_BUTTON, UI_COLORS } from '@/lib/constants';

interface ReceiversSectionProps {
  receivers: ReceiverData[];
  isPlacingReceiver: boolean;
  onStartPlacingReceiver: () => void;
  onDeleteReceiver: (id: string) => void;
  onUpdateReceiverName: (id: string, name: string) => void;
}

export function ReceiversSection({
  receivers,
  isPlacingReceiver,
  onStartPlacingReceiver,
  onDeleteReceiver,
  onUpdateReceiverName
}: ReceiversSectionProps) {
  const [editingReceiverId, setEditingReceiverId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');

  // Inline name editing handlers
  const handleDoubleClick = (receiver: ReceiverData) => {
    setEditingReceiverId(receiver.id);
    setEditingValue(receiver.name);
  };

  const handleEditSave = () => {
    if (editingReceiverId && editingValue.trim()) {
      onUpdateReceiverName(editingReceiverId, editingValue.trim());
    }
    setEditingReceiverId(null);
  };

  const handleEditCancel = () => {
    setEditingReceiverId(null);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleEditSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleEditCancel();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-xs font-semibold" style={{ color: UI_COLORS.NEUTRAL_700 }}>
        Receivers
      </h4>

      {/* Create Receiver Button */}
      <button
        onClick={onStartPlacingReceiver}
        disabled={isPlacingReceiver}
        onMouseEnter={(e) => {
          if (!isPlacingReceiver) {
            e.currentTarget.style.opacity = '0.8';
          }
        }}
        onMouseLeave={(e) => {
          if (!isPlacingReceiver) {
            e.currentTarget.style.opacity = '1';
          }
        }}
        className="w-full py-2 px-4 text-white font-semibold rounded transition-colors"
        style={{
          backgroundColor: isPlacingReceiver ? UI_COLORS.NEUTRAL_400 : UI_COLORS.PRIMARY,
          borderRadius: '8px',
          fontSize: UI_BUTTON.FONT_SIZE,
          fontWeight: UI_BUTTON.FONT_WEIGHT,
          opacity: isPlacingReceiver ? 0.4 : 1,
          cursor: isPlacingReceiver ? 'not-allowed' : 'pointer'
        }}
      >
        {isPlacingReceiver ? 'Click in 3D to Place (ESC to cancel)' : '+ Create Receiver'}
      </button>

      {/* Receivers List */}
      {receivers.length > 0 && (
        <div className="space-y-2">
          {receivers.map((receiver) => (
            <div
              key={receiver.id}
              className="rounded p-2"
              style={{
                backgroundColor: 'white',
                borderColor: UI_COLORS.NEUTRAL_200,
                borderWidth: '1px',
                borderStyle: 'solid',
                borderRadius: '8px'
              }}
            >
              {/* Receiver Name - Editable */}
              <div className="flex items-center justify-between mb-1">
                {editingReceiverId === receiver.id ? (
                  <input
                    type="text"
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                    onBlur={handleEditSave}
                    onKeyDown={handleEditKeyDown}
                    autoFocus
                    className="flex-1 text-sm font-medium px-2 py-1 rounded outline-none focus:ring-1"
                    style={{
                      backgroundColor: UI_COLORS.NEUTRAL_100,
                      borderColor: UI_COLORS.PRIMARY,
                      borderRadius: '8px'
                    }}
                  />
                ) : (
                  <div
                    onDoubleClick={() => handleDoubleClick(receiver)}
                    onMouseEnter={(e) => e.currentTarget.style.color = UI_COLORS.PRIMARY}
                    onMouseLeave={(e) => e.currentTarget.style.color = UI_COLORS.NEUTRAL_800}
                    className="flex-1 text-sm font-medium cursor-pointer transition-colors group"
                    style={{ color: UI_COLORS.NEUTRAL_800 }}
                    title="Double-click to edit name"
                  >
                    {receiver.name}
                    <span className="text-[10px] ml-1 opacity-0 group-hover:opacity-50 transition-opacity">✏️</span>
                  </div>
                )}

                {/* Delete Button */}
                <button
                  onClick={() => onDeleteReceiver(receiver.id)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = UI_COLORS.ERROR;
                    e.currentTarget.style.backgroundColor = `${UI_COLORS.ERROR}10`;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = UI_COLORS.NEUTRAL_600;
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                  className="w-5 h-5 flex items-center justify-center text-lg rounded-full transition-colors leading-none"
                  style={{
                    color: UI_COLORS.NEUTRAL_600
                  }}
                  title="Delete receiver"
                >
                  ×
                </button>
              </div>

              {/* Position Display - Read-only */}
              <div className="text-xs font-mono" style={{ color: UI_COLORS.NEUTRAL_500 }}>
                Position: ({receiver.position[0].toFixed(2)}, {receiver.position[1].toFixed(2)}, {receiver.position[2].toFixed(2)})
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Help Text */}
      {receivers.length === 0 && isPlacingReceiver && (
        <p className="text-xs italic" style={{ color: UI_COLORS.NEUTRAL_500 }}>
          Click in the 3D scene to place a blue receiver sphere. Double-click on it to reset the camera view.
        </p>
      )}
    </div>
  );
}
